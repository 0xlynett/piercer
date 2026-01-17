/**
 * Inference child process
 * Runs node-llama-cpp in isolation for memory safety
 * Communicates with parent via RPC over IPC
 */

import {
  ChatHistoryItem,
  ChatModelSegment,
  getLlama,
  LlamaChatSession,
  LlamaChatResponseChunk,
  LlamaCompletion,
  Token,
  TokenBias,
  LlamaContext,
  Llama,
  LlamaModel,
} from "node-llama-cpp";
import { RPC } from "@piercer/rpc";
import { ParentProcessTransport } from "../rpc/child-process-transport";
import type {
  InferenceProcessFunctions,
  MainProcessFunctions,
  CompletionParams,
  ChatParams,
  TokenUsage,
} from "./types.js";

// Single shared Llama instances
let llama: Llama | null = null;
let currentModel: LlamaModel | null = null;
let currentContext: LlamaContext | null = null;

const MAX_SEQUENCE_INDEX = 1;

// Setup RPC communication with parent
const transport = new ParentProcessTransport();
const rpc = new RPC<InferenceProcessFunctions>(transport);
const parent = rpc.remote<MainProcessFunctions>();

/**
 * Format a chat completion chunk with support for reasoning content and tool calls
 */
function formatChatChunk(
  requestId: string,
  content: string | undefined,
  reasoningContent: string | undefined,
  toolCalls: any[] | undefined,
  logprobs: any
) {
  const delta: any = {};

  if (reasoningContent !== undefined) {
    delta.reasoning_content = reasoningContent;
  }
  if (content !== undefined) {
    delta.content = content;
  }
  if (toolCalls && toolCalls.length > 0) {
    delta.tool_calls = toolCalls;
  }

  return {
    id: requestId,
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "unknown",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: null,
        logprobs: logprobs ?? null,
      },
    ],
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
  return formatChatChunk(requestId, undefined, undefined, toolCalls, null);
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
    maxTokens: params.max_tokens ?? 4096,
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
        sequences: MAX_SEQUENCE_INDEX,
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

      if (currentContext.sequencesLeft == 0)
        throw new Error("No sequences left");

      const sequence = currentContext.getSequence();
      const completion = new LlamaCompletion({
        contextSequence: sequence,
      });

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

      // Map messages to chat history, supporting reasoning content and tool calls
      const history: ChatHistoryItem[] = params.messages.map((v) => {
        if (
          v.role != "system" &&
          v.role != "user" &&
          v.role != "assistant" &&
          v.role != "tool"
        )
          throw new Error(
            `Incorrect role: ${v.role} is not one of system, user, assistant, tool`
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
        } else if (v.role == "tool") {
          // Tool result message - convert to model response with function call result
          return {
            type: "model" as const,
            response: [
              {
                type: "functionCall" as const,
                name: v.tool_name || "",
                params: {},
                result: v.content,
              },
            ],
          };
        } else {
          // Assistant message
          const assistantItem: ChatHistoryItem = {
            type: "model" as const,
            response: [],
          };

          // If this message has reasoning_content, include it as a segment
          if ("reasoning_content" in v && v.reasoning_content) {
            const reasoningSegment: ChatModelSegment = {
              type: "segment",
              segmentType: "thought",
              text: v.reasoning_content,
              ended: true,
            };
            assistantItem.response.push(reasoningSegment);
          }

          // Add the regular content
          if (v.content) {
            assistantItem.response.push(v.content);
          }

          return assistantItem;
        }
      });

      console.log("Creating session...");
      if (currentContext.sequencesLeft == 0)
        throw new Error("No sequences left");

      const sequence = currentContext.getSequence();
      const currentSession = new LlamaChatSession({
        contextSequence: sequence,
      });

      // Set the chat history using the session's method
      currentSession.setChatHistory(history);

      console.log(currentSession.getChatHistory());

      // Track token counts
      let promptTokens = 0;
      let completionTokens = 0;
      let thoughtTokens = 0;

      // Build ChatHistoryItem[] from chunks - accumulate response content
      const responseContent: Array<string | ChatModelSegment> = [];
      let currentSegment: ChatModelSegment | null = null;
      let hasToolCall = false;
      const toolCalls: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }> = [];

      // Get the last user message for prompting
      const lastUserMessage = params.messages
        .filter((m) => m.role === "user")
        .pop();
      const promptText = lastUserMessage ? lastUserMessage.content : "";

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

          // Handle different chunk types
          if (chunk.type === "segment") {
            // Handle reasoning/thought segments
            const segmentType = chunk.segmentType as "thought" | "comment";

            // Check for segment start/end via timestamps
            const isSegmentStart = chunk.segmentStartTime !== undefined;
            const isSegmentEnd = chunk.segmentEndTime !== undefined;

            if (
              currentSegment &&
              currentSegment.segmentType === segmentType &&
              !currentSegment.ended
            ) {
              // Continue current segment
              currentSegment.text += chunk.text;
              if (isSegmentEnd) {
                currentSegment.ended = true;
                currentSegment.endTime = chunk.segmentEndTime?.toISOString();
                currentSegment = null;
              }
            } else if (isSegmentStart || chunk.text.length > 0) {
              // Start new segment (or continue if we have text)
              currentSegment = {
                type: "segment",
                segmentType,
                text: chunk.text,
                ended: isSegmentEnd,
                startTime: chunk.segmentStartTime?.toISOString(),
                endTime: chunk.segmentEndTime?.toISOString(),
              };
              responseContent.push(currentSegment);
            }
          } else {
            // Regular text chunk (type is undefined for main response)
            if (currentSegment && !currentSegment.ended) {
              // Close any open segment before adding text
              currentSegment.ended = true;
              currentSegment = null;
            }

            // Add text to response
            if (chunk.text.length > 0) {
              responseContent.push(chunk.text);
            }
          }

          // Format and send the chunk
          const isThoughtSegment =
            chunk.type === "segment" && chunk.segmentType === "thought";
          const isCommentSegment =
            chunk.type === "segment" && chunk.segmentType === "comment";
          const content =
            isThoughtSegment || isCommentSegment ? undefined : chunk.text;
          const reasoningContent = isThoughtSegment ? chunk.text : undefined;

          const formattedChunk = formatChatChunk(
            params.requestId,
            content,
            reasoningContent,
            hasToolCall ? toolCalls : undefined,
            params.logprobs
              ? { content: chunk.tokens?.map((t: any) => ({ token: t })) || [] }
              : null
          );
          parent.receiveChunk({
            requestId: params.requestId,
            data: formattedChunk,
          });
        },
        onFunctionCall: (functionCall: any) => {
          // Handle function call
          hasToolCall = true;
          const toolCall = {
            id: functionCall.id || `tool-${toolCalls.length}`,
            type: "function",
            function: {
              name: functionCall.functionName || "",
              arguments: JSON.stringify(functionCall.params || {}),
            },
          };
          toolCalls.push(toolCall);

          // Send tool call chunk
          const formattedChunk = formatToolCallChunk(
            params.requestId,
            toolCalls
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
