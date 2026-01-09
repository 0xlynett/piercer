/**
 * Inference child process
 * Runs node-llama-cpp in isolation for memory safety
 * Communicates with parent via RPC over IPC
 */

import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { RPC } from "@piercer/rpc";
import { ParentProcessTransport } from "../rpc/child-process-transport.js";
import type {
  InferenceProcessFunctions,
  MainProcessFunctions,
  CompletionParams,
  ChatParams,
} from "./types.js";

// Single shared Llama instance (CRITICAL: reuse this, don't call getLlama multiple times)
let llama: any = null;
let currentModel: any = null;
let currentContext: any = null;
let currentSession: LlamaChatSession | null = null;

// Setup RPC communication with parent
const transport = new ParentProcessTransport();
const rpc = new RPC<InferenceProcessFunctions>(transport);
const parent = rpc.remote<MainProcessFunctions>();

/**
 * Map OpenAI parameters to llama.cpp parameters
 */
function mapParameters(params: CompletionParams | ChatParams) {
  return {
    maxTokens: params.max_tokens,
    temperature: params.temperature,
    topP: params.top_p,
    stopStrings: params.stop,
    // Note: node-llama-cpp may not support all OpenAI params
  };
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
        currentSession = null;
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

      console.log("Creating session...");
      const sequence = currentContext.getSequence();
      currentSession = new LlamaChatSession({
        contextSequence: sequence,
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
    if (!currentSession) {
      throw new Error("No model loaded");
    }

    try {
      const llamaParams = mapParameters(params);
      const stream = params.stream !== false; // Default to streaming

      if (stream) {
        // Streaming mode: send chunks as they arrive
        await currentSession.prompt(params.prompt, {
          ...llamaParams,
          onTextChunk: (chunk: string) => {
            // Send text chunk to parent
            parent.receiveChunk({
              requestId: params.requestId,
              data: {
                id: `cmpl-${Date.now()}`,
                object: "text_completion",
                created: Math.floor(Date.now() / 1000),
                model: params.model,
                choices: [
                  {
                    index: 0,
                    text: chunk,
                    finish_reason: null,
                  },
                ],
              },
            });
          },
        });

        // Send completion signal
        await parent.receiveComplete({
          requestId: params.requestId,
          data: "[DONE]",
        });
      } else {
        // Non-streaming: accumulate all chunks
        let fullText = "";
        await currentSession.prompt(params.prompt, {
          ...llamaParams,
          onTextChunk: (chunk: string) => {
            fullText += chunk;
          },
        });

        // Send complete response
        await parent.receiveComplete({
          requestId: params.requestId,
          data: {
            id: `cmpl-${Date.now()}`,
            object: "text_completion",
            created: Math.floor(Date.now() / 1000),
            model: params.model,
            choices: [
              {
                index: 0,
                text: fullText,
                finish_reason: "stop",
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 0, // Would need to calculate
              completion_tokens: 0,
              total_tokens: 0,
            },
          },
        });
      }
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
    if (!currentSession) {
      throw new Error("No model loaded");
    }

    try {
      const llamaParams = mapParameters(params);
      const stream = params.stream !== false; // Default to streaming

      // Format messages into a prompt
      // This is a simple format - could be improved based on model
      const prompt = params.messages
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join("\n") + "\nassistant:";

      if (stream) {
        // Streaming mode: send chunks as they arrive
        await currentSession.prompt(prompt, {
          ...llamaParams,
          onTextChunk: (chunk: string) => {
            // Send text chunk to parent
            parent.receiveChunk({
              requestId: params.requestId,
              data: {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: params.model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: "assistant",
                      content: chunk,
                    },
                    finish_reason: null,
                  },
                ],
              },
            });
          },
        });

        // Send completion signal
        await parent.receiveComplete({
          requestId: params.requestId,
          data: "[DONE]",
        });
      } else {
        // Non-streaming: accumulate all chunks
        let fullText = "";
        await currentSession.prompt(prompt, {
          ...llamaParams,
          onTextChunk: (chunk: string) => {
            fullText += chunk;
          },
        });

        // Send complete response
        await parent.receiveComplete({
          requestId: params.requestId,
          data: {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: params.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: fullText,
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
          },
        });
      }
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
      currentSession = null;

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
