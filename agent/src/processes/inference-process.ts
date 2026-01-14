/**
 * Inference child process
 * Runs node-llama-cpp in isolation for memory safety
 * Communicates with parent via RPC over IPC
 */

import {
  ChatHistoryItem,
  getLlama,
  LlamaChatSession,
  LlamaChatResponseChunk,
  LlamaCompletion,
  LlamaCompletionOptions,
  Token,
  TokenBias,
} from "node-llama-cpp";
import { RPC } from "@piercer/rpc";
import { ParentProcessTransport } from "../rpc/child-process-transport.js";
import type {
  InferenceProcessFunctions,
  MainProcessFunctions,
  CompletionParams,
  ChatParams,
  TokenUsage,
} from "./types.js";

// Single shared Llama instances
let llama: any = null;
let currentModel: any = null;
let currentContext: any = null;

let sequenceIndex = 0;

// Setup RPC communication with parent
const transport = new ParentProcessTransport();
const rpc = new RPC<InferenceProcessFunctions>(transport);
const parent = rpc.remote<MainProcessFunctions>();

/**
 * Format a chat completion chunk with support for reasoning content and tool calls
 */
function formatChatChunk(
  text: string,
  requestId: string,
  toolCalls?: any[],
  content?: string,
  reasoningContent?: string,
  logprobs?: any
) {
  const choice: any = {
    index: 0,
    delta: {},
    finish_reason: null,
  };

  if (reasoningContent !== undefined) {
    choice.delta.reasoning_content = reasoningContent;
  }
  if (content !== undefined) {
    choice.delta.content = content;
  }
  if (toolCalls && toolCalls.length > 0) {
    choice.delta.tool_calls = toolCalls;
  }
  if (logprobs !== undefined) {
    choice.logprobs = logprobs;
  }

  return {
    id: requestId,
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "unknown",
    choices: [choice],
  };
}

/**
 * Format a tool call chunk
 */
function formatToolCallChunk(
  requestId: string,
  toolCalls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>
) {
  return formatChatChunk("", requestId, toolCalls);
}

/**
 * Format a text completion chunk
 */
function formatTextCompletionChunk(
  text: string,
  requestId: string,
  model: string,
  logprobs?: any
) {
  return {
    id: `cmpl-${Date.now()}`,
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        text,
        finish_reason: null,
        logprobs: logprobs ?? null,
      },
    ],
  };
}

/**
 * Convert OpenAI logit_bias format to TokenBias
 */
function createTokenBias(
  logitBias: Record<string, number> | undefined,
  model: any
): TokenBias | undefined {
  if (!logitBias || Object.keys(logitBias).length === 0) {
    return undefined;
  }

  const tokenBias = new TokenBias(model.tokenizer);

  for (const [tokenStr, bias] of Object.entries(logitBias)) {
    // Convert token ID string to number
    const tokenId = parseInt(tokenStr, 10);
    if (isNaN(tokenId)) {
      // If it's a string token, we need to tokenize it
      const tokens = model.tokenize(tokenStr);
      if (tokens.length > 0) {
        if (typeof bias === "number") {
          tokenBias.set(tokens[0] as Token, bias / 100);
        } else if (bias === -1) {
          tokenBias.set(tokens[0] as Token, "never");
        }
      }
      continue;
    }

    if (typeof bias === "number") {
      // OpenAI logit_bias values are typically -100 to 100
      // node-llama-cpp TokenBias accepts numbers directly
      tokenBias.set(tokenId as Token, bias / 100); // Normalize to -1 to 1 range
    } else if (bias === -1) {
      // OpenAI uses -1 to prevent token generation
      tokenBias.set(tokenId as Token, "never");
    }
  }

  return tokenBias;
}

/**
 * Map OpenAI parameters to llama.cpp parameters
 */
function mapParameters(params: CompletionParams | ChatParams, model: any) {
  const llamaParams: any = {
    maxTokens: params.max_tokens ?? 1024,
    temperature: params.temperature ?? 1,
    topP: params.top_p,
    stopStrings: params.stop,
  };

  // Add logit bias if provided
  if ("logit_bias" in params && params.logit_bias) {
    llamaParams.tokenBias = createTokenBias(params.logit_bias, model);
  }

  // Add reasoning budget if provided (for chat)
  if ("thought_tokens" in params && params.thought_tokens) {
    llamaParams.budgets = {
      thoughtTokens: params.thought_tokens,
    };
  }

  // Add logprobs if requested
  if ("logprobs" in params && params.logprobs) {
    llamaParams.includeLogProbs = true;
  }

  return llamaParams;
}

/**
 * Expose functions for parent to call
 */
const functions: InferenceProcessFunctions = {
  async loadModel(params) {
    try {
      console.log("Loading model:", params.modelPath);

      // Initialize Llama instance once
      if (!llama) {
        console.log("Initializing Llama instance...");
        llama = await getLlama();
        console.log("Llama instance initialized");
      }

      // Dispose previous model if exists
      if (currentModel && !currentModel.disposed) {
        console.log("Disposing previous model");
        await currentModel.dispose();
        currentModel = null;
        currentContext = null;
      }

      // Load new model with auto-disposal support
      console.log("Loading model file...");
      currentModel = await llama.loadModel({
        modelPath: params.modelPath,
        defaultContextFlashAttention: true, // Performance optimization
      });

      console.log("Creating context...");
      currentContext = await currentModel.createContext({
        contextSize: params.contextSize,
      });

      console.log("Model loaded successfully");
      return { success: true };
    } catch (error: any) {
      console.error("Failed to load model:", error);
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  },

  async completion(params) {
    if (!currentContext || !currentModel) {
      throw new Error("No model loaded");
    }

    try {
      const llamaParams = mapParameters(params, currentModel);

      const sequence = currentContext.getSequence(sequenceIndex);
      const completion = new LlamaCompletion({
        contextSequence: sequence,
      });

      if (++sequenceIndex > 4) sequenceIndex = 0;

      // Track prompt tokens using tokenize
      const promptTokens = currentModel.tokenize(params.prompt).length;

      // Track output tokens
      let completionTokens = 0;

      // Streaming mode: send chunks as they arrive
      await completion.generateCompletion(params.prompt, {
        ...llamaParams,
        seed: Math.floor(Math.random() * 1_000_000),
        onTextChunk: (chunk: string) => {
          // Send text chunk to parent
          parent.receiveChunk({
            requestId: params.requestId,
            data: formatTextCompletionChunk(
              chunk,
              params.requestId,
              params.model,
              params.logprobs ? { content: [] } : undefined
            ),
          });
        },
        onToken: (tokens: Token[]) => {
          completionTokens += tokens.length;
        },
      });

      // Send completion signal with usage
      const usage: TokenUsage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      };

      await parent.receiveComplete({
        requestId: params.requestId,
        data: "[DONE]",
        usage,
      });

      sequence.dispose();
    } catch (error: any) {
      console.error("Completion error:", error);
      await parent.receiveError({
        requestId: params.requestId,
        error: {
          message: error.message || String(error),
          type: "inference_error",
        },
      });
    }
  },

  async chat(params) {
    if (!currentContext || !currentModel) {
      throw new Error("No model loaded");
    }

    try {
      const llamaParams = mapParameters(params, currentModel);

      // Map messages to chat history, supporting reasoning content
      const history: ChatHistoryItem[] = params.messages.map((v) => {
        if (v.role != "system" && v.role != "user" && v.role != "assistant")
          throw new Error(
            `Incorrect role: ${v.role} is not one of system, user, assistant`
          );

        if (v.role == "system") {
          return {
            type: "system" as const,
            text: v.content,
          };
        } else if (v.role == "user") {
          return {
            type: "user" as const,
            text: v.content,
          };
        } else {
          const assistantItem: ChatHistoryItem = {
            type: "model" as const,
            response: [v.content],
          };

          // If this message has reasoning_content, include it in response
          if ("reasoning_content" in v && v.reasoning_content) {
            // Include reasoning content as part of the response for context
            assistantItem.response = [String(v.reasoning_content), v.content];
          }

          return assistantItem;
        }
      });

      console.log("Creating session...");
      const sequence = currentContext.getSequence(sequenceIndex);
      const currentSession = new LlamaChatSession({
        contextSequence: sequence,
      });

      if (++sequenceIndex > 4) sequenceIndex = 0;

      // Track token counts
      let promptTokens = 0;
      let completionTokens = 0;
      let thoughtTokens = 0;

      // Calculate prompt tokens
      for (const message of params.messages) {
        promptTokens += currentModel.tokenize(message.content || "").length;
      }

      // Convert messages to a single prompt string for LlamaChatSession
      const promptText = params.messages
        .map((msg) => {
          if (msg.role === "system") {
            return `System: ${msg.content}`;
          } else if (msg.role === "user") {
            return `User: ${msg.content}`;
          } else if (msg.role === "assistant") {
            return `Assistant: ${msg.content}`;
          }
          return "";
        })
        .join("\n");

      // Streaming mode: send chunks as they arrive
      await currentSession.prompt(promptText, {
        ...llamaParams,
        seed: Math.floor(Math.random() * 1_000_000),
        onResponseChunk: (chunk: LlamaChatResponseChunk) => {
          // Track tokens
          if (chunk.tokens) {
            const isThoughtSegment =
              chunk.type === "segment" && chunk.segmentType === "thought";
            if (isThoughtSegment) {
              thoughtTokens += chunk.tokens.length;
            } else {
              completionTokens += chunk.tokens.length;
            }
          }

          // Handle reasoning chunks
          const isReasoning =
            chunk.type === "segment" && chunk.segmentType === "thought";
          const content = isReasoning ? undefined : chunk.text;
          const reasoningContent = isReasoning ? chunk.text : undefined;

          const formattedChunk = formatChatChunk(
            chunk.text,
            params.requestId,
            undefined, // no tool calls in chunk
            content,
            reasoningContent,
            params.logprobs
              ? { content: chunk.tokens?.map((t: any) => ({ token: t })) || [] }
              : undefined
          );
          parent.receiveChunk({
            requestId: params.requestId,
            data: formattedChunk,
          });
        },
      });

      // Send completion signal with usage
      const usage: TokenUsage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        thought_tokens: thoughtTokens,
        total_tokens: promptTokens + completionTokens + thoughtTokens,
      };

      await parent.receiveComplete({
        requestId: params.requestId,
        data: "[DONE]",
        usage,
      });

      sequence.dispose();
    } catch (error: any) {
      console.error("Chat error:", error);
      await parent.receiveError({
        requestId: params.requestId,
        error: {
          message: error.message || String(error),
          type: "inference_error",
        },
      });
    }
  },

  async unloadModel() {
    try {
      console.log("Unloading model");

      // Dispose resources (hierarchical disposal)
      if (currentModel && !currentModel.disposed) {
        await currentModel.dispose();
      }

      currentModel = null;
      currentContext = null;

      return { success: true };
    } catch (error: any) {
      console.error("Error unloading model:", error);
      return { success: false };
    }
  },

  async shutdown() {
    console.log("Shutting down inference process");

    // Clean up all resources
    if (currentModel && !currentModel.disposed) {
      await currentModel.dispose();
    }

    // Exit process
    setTimeout(() => {
      process.exit(0);
    }, 100);
  },
};

// Expose functions
rpc.expose(functions);

// Handle process signals
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down");
  await functions.shutdown();
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT, shutting down");
  await functions.shutdown();
});

// Error handling
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

console.log("Inference process ready");
