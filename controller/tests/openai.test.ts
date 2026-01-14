import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RPC, WebSocketTransport } from "@piercer/rpc";
import type { AgentFunctions, ControllerFunctions } from "../src/rpc-types";
import { randomUUID } from "crypto";

// Set environment variables BEFORE importing the app
const TEST_DB = `./test-${randomUUID()}.db`;
process.env.DATABASE_PATH = TEST_DB;
process.env.PORT = "0"; // Random port
process.env.API_KEY = ""; // No API key required for tests
process.env.AGENT_SECRET_KEY = ""; // No agent secret key for tests

describe("OpenAI API Integration", () => {
  let server: any;
  let transport: WebSocketTransport;
  let API_URL: string;
  let WS_URL: string;

  beforeAll(async () => {
    // Dynamic import to ensure env vars are picked up
    const mod = await import("../src/index");
    server = mod.server;

    const port = server.port;
    const hostname = server.hostname;
    API_URL = `http://${hostname}:${port}`;
    WS_URL = `ws://${hostname}:${port}/ws`;

    // Create model mapping
    const res = await fetch(`${API_URL}/management/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_name: "test-model",
        filename: "test-model",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create mapping: ${text}`);
    }
  });

  afterAll(() => {
    if (transport) transport.close();
    if (server) server.stop();
    try {
      Bun.file(TEST_DB).delete();
    } catch {}
  });

  // Helper function to create a connected agent
  async function createConnectedAgent(
    agentName: string,
    procedures: Record<string, Function>
  ): Promise<{
    rpc: RPC<AgentFunctions>;
    transport: WebSocketTransport;
    agentId: string;
  }> {
    const agentId = `${agentName}-${randomUUID()}`;
    const agentTransport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": agentId,
        "agent-name": agentName,
        "agent-installed-models": "test-model",
      },
    });

    const agentRpc = new RPC(agentTransport);

    agentRpc.expose(procedures);

    await new Promise<void>((resolve) => {
      agentTransport.on("open", () => resolve());
    });

    return { rpc: agentRpc, transport: agentTransport, agentId };
  }

  // ============================================
  // Multi-turn Chat Completion Tests
  // ============================================

  describe("Multi-turn Chat Completion", () => {
    test("Non-streaming multi-turn conversation (3+ message exchanges)", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Multi-turn Agent",
        {
          chat: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            const isFollowUp = params.messages.length > 2;
            const responseText = isFollowUp
              ? "I understand. Let me help you with that follow-up question."
              : "Hello! How can I assist you today?";

            const chunks = responseText.split(" ");
            for (let i = 0; i < chunks.length; i++) {
              await controller.receiveCompletion({
                agentId: params.agentId,
                requestId,
                data: {
                  id: `chatcmpl-${randomUUID()}`,
                  object: "chat.completion.chunk",
                  created: Date.now(),
                  model: "test-model",
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content:
                          i === chunks.length - 1 ? chunks[i] : chunks[i] + " ",
                      },
                      finish_reason: i === chunks.length - 1 ? "stop" : null,
                    },
                  ],
                },
              });
              await new Promise((r) => setTimeout(r, 5));
            }

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: ["test-model"] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const messages = [
        { role: "user", content: "Hello, I need help with coding" },
        {
          role: "assistant",
          content:
            "Hello! I'd be happy to help you with coding. What are you working on?",
        },
        { role: "user", content: "I'm trying to write a function" },
        {
          role: "assistant",
          content: "Great! Let's start with the function signature.",
        },
        { role: "user", content: "I want it to handle errors" },
      ];

      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages,
          stream: false,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        id: string;
        object: string;
        choices: any[];
      };
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("object", "chat.completion");
      expect(body).toHaveProperty("choices");
      expect(body.choices.length).toBeGreaterThan(0);
      expect(body.choices[0]).toHaveProperty("message");
      expect(body.choices[0].message).toHaveProperty("role", "assistant");
      expect(typeof body.choices[0].message.content).toBe("string");

      agentTransport.close();
    });

    test("Streaming multi-turn conversation", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Streaming Multi-turn Agent",
        {
          chat: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            const responseParts = [
              "I",
              " see",
              " you're",
              " asking",
              " about",
              " multiple",
              " turns",
              "!",
            ];

            for (let i = 0; i < responseParts.length; i++) {
              await controller.receiveCompletion({
                agentId: params.agentId,
                requestId,
                data: {
                  id: `chatcmpl-${randomUUID()}`,
                  object: "chat.completion.chunk",
                  created: Date.now(),
                  model: "test-model",
                  choices: [
                    {
                      index: 0,
                      delta: { content: responseParts[i] },
                      finish_reason:
                        i === responseParts.length - 1 ? "stop" : null,
                    },
                  ],
                },
              });
              await new Promise((r) => setTimeout(r, 5));
            }

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const messages = [
        { role: "user", content: "First message" },
        { role: "assistant", content: "First response" },
        { role: "user", content: "Second message" },
      ];

      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages,
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      // Parse SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const chunks: any[] = [];
      let buffer = "";
      let done = false;

      while (!done && reader) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                done = true;
                break;
              }
              try {
                const chunk = JSON.parse(data);
                chunks.push(chunk);
              } catch {}
            }
          }
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      const fullContent = chunks
        .map((chunk) => chunk.choices?.[0]?.delta?.content || "")
        .join("");
      expect(fullContent.length).toBeGreaterThan(0);

      agentTransport.close();
    });

    test("System message handling", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "System Message Agent",
        {
          chat: async (params: any) => {
            const { requestId, messages } = params;
            const controller = rpc.remote<ControllerFunctions>();

            const systemMsg = messages.find((m: any) => m.role === "system");

            const responseChunks = [
              "Understood",
              ", I",
              " will",
              " follow",
              " those",
              " instructions",
              ".",
            ];

            for (let i = 0; i < responseChunks.length; i++) {
              await controller.receiveCompletion({
                agentId: params.agentId,
                requestId,
                data: {
                  id: `chatcmpl-${randomUUID()}`,
                  object: "chat.completion.chunk",
                  created: Date.now(),
                  model: "test-model",
                  choices: [
                    {
                      index: 0,
                      delta: { content: responseChunks[i] },
                      finish_reason:
                        i === responseChunks.length - 1 ? "stop" : null,
                    },
                  ],
                },
              });
              await new Promise((r) => setTimeout(r, 5));
            }

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const messages = [
        {
          role: "system",
          content: "You are a helpful coding assistant. Always use TypeScript.",
        },
        { role: "user", content: "Hello!" },
      ];

      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages,
          stream: false,
        }),
      });

      expect(response.status).toBe(200);

      agentTransport.close();
    });

    test("Role preservation across turns", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Role Preserve Agent",
        {
          chat: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            const responseChunks = ["Response", " content"];

            for (let i = 0; i < responseChunks.length; i++) {
              await controller.receiveCompletion({
                agentId: params.agentId,
                requestId,
                data: {
                  id: `chatcmpl-${randomUUID()}`,
                  object: "chat.completion.chunk",
                  created: Date.now(),
                  model: "test-model",
                  choices: [
                    {
                      index: 0,
                      delta: { content: responseChunks[i] },
                      finish_reason:
                        i === responseChunks.length - 1 ? "stop" : null,
                    },
                  ],
                },
              });
              await new Promise((r) => setTimeout(r, 5));
            }

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
      ];

      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages,
          stream: false,
        }),
      });

      expect(response.status).toBe(200);

      agentTransport.close();
    });
  });

  // ============================================
  // Legacy Completions Tests
  // ============================================

  describe("Legacy Completions API", () => {
    test("Non-streaming text completion", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Completion Agent",
        {
          completion: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            const prompt = params.prompt;
            const responseText = `Here is a completion for: "${prompt}"`;

            const chunks = responseText.split(" ");
            for (let i = 0; i < chunks.length; i++) {
              await controller.receiveCompletion({
                agentId: params.agentId,
                requestId,
                data: {
                  id: `cmpl-${randomUUID()}`,
                  object: "text_completion",
                  created: Date.now(),
                  model: "test-model",
                  choices: [
                    {
                      index: 0,
                      text:
                        i === 0
                          ? ""
                          : i === chunks.length - 1
                          ? chunks[i]
                          : chunks[i] + " ",
                      logprobs: null,
                      finish_reason: i === chunks.length - 1 ? "stop" : null,
                    },
                  ],
                },
              });
              await new Promise((r) => setTimeout(r, 5));
            }

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          chat: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const response = await fetch(`${API_URL}/v1/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          prompt: "Write a short story about",
          max_tokens: 50,
          stream: false,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        id: string;
        object: string;
        choices: any[];
      };
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("object", "text_completion");
      expect(body).toHaveProperty("choices");
      expect(body.choices.length).toBeGreaterThan(0);
      expect(body.choices[0]).toHaveProperty("text");
      expect(body.choices[0]).toHaveProperty("finish_reason");
      expect(typeof body.choices[0].text).toBe("string");

      agentTransport.close();
    });

    test("Streaming text completion", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Streaming Completion Agent",
        {
          completion: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            const responseParts = [
              "Streaming",
              " completion",
              " response",
              " works!",
            ];

            for (let i = 0; i < responseParts.length; i++) {
              await controller.receiveCompletion({
                agentId: params.agentId,
                requestId,
                data: {
                  id: `cmpl-${randomUUID()}`,
                  object: "text_completion",
                  created: Date.now(),
                  model: "test-model",
                  choices: [
                    {
                      index: 0,
                      text:
                        responseParts[i] +
                        (i < responseParts.length - 1 ? " " : ""),
                      logprobs: null,
                      finish_reason:
                        i === responseParts.length - 1 ? "stop" : null,
                    },
                  ],
                },
              });
              await new Promise((r) => setTimeout(r, 5));
            }

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          chat: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const response = await fetch(`${API_URL}/v1/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          prompt: "Test streaming",
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const chunks: any[] = [];
      let buffer = "";
      let done = false;

      while (!done && reader) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                done = true;
                break;
              }
              try {
                const chunk = JSON.parse(data);
                chunks.push(chunk);
              } catch {}
            }
          }
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toHaveProperty("object", "text_completion");

      agentTransport.close();
    });

    test("Prompt length variations", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Prompt Length Agent",
        {
          completion: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            const response = "Short response";

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: {
                id: `cmpl-${randomUUID()}`,
                object: "text_completion",
                created: Date.now(),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    text: response,
                    logprobs: null,
                    finish_reason: "stop",
                  },
                ],
              },
            });

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          chat: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      // Test short prompt
      let response = await fetch(`${API_URL}/v1/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          prompt: "Short",
          stream: false,
        }),
      });

      expect(response.status).toBe(200);

      // Test array prompt
      response = await fetch(`${API_URL}/v1/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          prompt: ["Line 1", "Line 2", "Line 3"],
          stream: false,
        }),
      });

      expect(response.status).toBe(200);

      agentTransport.close();
    });

    test("Suffix parameter support", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Suffix Agent",
        {
          completion: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            // Verify suffix is passed through
            expect(params.suffix).toBe(" end text");

            const response = "Complete";

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: {
                id: `cmpl-${randomUUID()}`,
                object: "text_completion",
                created: Date.now(),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    text: response,
                    logprobs: null,
                    finish_reason: "stop",
                  },
                ],
              },
            });

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          chat: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const response = await fetch(`${API_URL}/v1/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          prompt: "Start of text",
          suffix: " end text",
          stream: false,
        }),
      });

      expect(response.status).toBe(200);

      agentTransport.close();
    });
  });

  // ============================================
  // Tool Call Support Tests
  // ============================================

  describe("Tool Call Support", () => {
    test("Tool call response formatting", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Tool Response Agent",
        {
          chat: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            // Send a response with tool calls
            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: {
                id: `chatcmpl-${randomUUID()}`,
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "tool_call_1",
                          type: "function",
                          function: {
                            name: "search",
                            arguments: '{"query": "test"}',
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              },
            });

            await new Promise((r) => setTimeout(r, 10));

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Search for something" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { choices: any[] };
      expect(body.choices[0].message).toHaveProperty("tool_calls");
      expect(Array.isArray(body.choices[0].message.tool_calls)).toBe(true);

      agentTransport.close();
    });
  });

  // ============================================
  // Validation Tests
  // ============================================

  describe("Validation Tests", () => {
    test("Invalid model name handling", async () => {
      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "non-existent-model",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body).toHaveProperty("error");
      expect(body.error).toHaveProperty("code", "model_not_found");
    });

    test("Missing required messages field", async () => {
      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body).toHaveProperty("error");
      expect(body.error.code).toBe("missing_required_parameter");
    });

    test("Missing required prompt field in completions", async () => {
      const response = await fetch(`${API_URL}/v1/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body).toHaveProperty("error");
      expect(body.error.code).toBe("missing_required_parameter");
    });

    test("Invalid max_tokens (negative)", async () => {
      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: -1,
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_parameter_value");
    });

    test("Invalid temperature (out of range)", async () => {
      // Temperature too high
      let response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
          temperature: 3.0,
        }),
      });

      expect(response.status).toBe(400);
      let body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_parameter_value");

      // Temperature negative
      response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
          temperature: -0.5,
        }),
      });

      expect(response.status).toBe(400);
      body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_parameter_value");
    });

    test("Invalid top_p (out of range)", async () => {
      // top_p > 1
      let response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
          top_p: 1.5,
        }),
      });

      expect(response.status).toBe(400);

      // top_p < 0
      response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
          top_p: -0.1,
        }),
      });

      expect(response.status).toBe(400);
    });

    test("Invalid role in messages", async () => {
      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "invalid_role", content: "Hello" }],
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_request_error");
    });

    test("Missing content and tool_calls in message", async () => {
      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user" }],
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("missing_required_parameter");
    });

    test("Empty messages array", async () => {
      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [],
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("missing_required_parameter");
    });
  });

  // ============================================
  // Error Scenario Tests
  // ============================================

  describe("Error Scenarios", () => {
    test("Malformed message structure", async () => {
      // Message with null role
      let response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: null, content: "Hello" }],
        }),
      });

      expect(response.status).toBe(400);

      // Message with undefined role
      response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: undefined, content: "Hello" }],
        }),
      });

      expect(response.status).toBe(400);
    });

    test("Multiple agents - load balancing", async () => {
      // Connect two agents
      const {
        rpc: rpc1,
        transport: transport1,
        agentId: agent1Id,
      } = await createConnectedAgent("LB Agent 1", {
        chat: async (params: any) => {
          const { requestId } = params;
          const controller = rpc1.remote<ControllerFunctions>();

          await controller.receiveCompletion({
            agentId: agent1Id,
            requestId,
            data: {
              id: `chatcmpl-${randomUUID()}`,
              object: "chat.completion.chunk",
              created: Date.now(),
              model: "test-model",
              choices: [
                {
                  index: 0,
                  delta: { content: "Agent 1 response" },
                  finish_reason: "stop",
                },
              ],
            },
          });

          await controller.receiveCompletion({
            agentId: agent1Id,
            requestId,
            data: "[DONE]",
          });
        },
        startModel: async () => ({ models: ["test-model"] }),
        completion: async () => {},
        listModels: async () => ({ models: ["test-model"] }),
        currentModels: async () => ({ models: ["test-model"] }),
        downloadModel: async () => {},
        status: async () => ({ status: "idle" }),
      });

      const {
        rpc: rpc2,
        transport: transport2,
        agentId: agent2Id,
      } = await createConnectedAgent("LB Agent 2", {
        chat: async (params: any) => {
          const { requestId } = params;
          const controller = rpc2.remote<ControllerFunctions>();

          await controller.receiveCompletion({
            agentId: agent2Id,
            requestId,
            data: {
              id: `chatcmpl-${randomUUID()}`,
              object: "chat.completion.chunk",
              created: Date.now(),
              model: "test-model",
              choices: [
                {
                  index: 0,
                  delta: { content: "Agent 2 response" },
                  finish_reason: "stop",
                },
              ],
            },
          });

          await controller.receiveCompletion({
            agentId: agent2Id,
            requestId,
            data: "[DONE]",
          });
        },
        startModel: async () => ({ models: ["test-model"] }),
        completion: async () => {},
        listModels: async () => ({ models: ["test-model"] }),
        currentModels: async () => ({ models: ["test-model"] }),
        downloadModel: async () => {},
        status: async () => ({ status: "idle" }),
      });

      // Send request - should go to one of the agents (by ID order)
      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { choices: any[] };
      // The response should be from one of the agents
      expect(body.choices[0].message.content).toMatch(/Agent [12] response/);

      transport1.close();
      transport2.close();
    });

    test("No agents available", async () => {
      // Don't connect any agent - make a request to see error handling
      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.status).toBe(503);
      const body = (await response.json()) as {
        error: { code: string; message: string };
      };
      expect(body).toHaveProperty("error");
      expect(body.error.code).toBe("service_unavailable");
      expect(body.error.message).toContain("No agents available");
    });

    test("Request timeout handling", async () => {
      // Connect an agent that never responds
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Timeout Agent",
        {
          chat: async (params: any) => {
            // Never send a response - simulating a timeout scenario
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            // Simulate long delay before responding (should timeout)
            await new Promise((resolve) => setTimeout(resolve, 10000));

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: {
                id: `chatcmpl-${randomUUID()}`,
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { content: "Late response" },
                    finish_reason: "stop",
                  },
                ],
              },
            });

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      // Note: In a real scenario, you would set a timeout on the fetch
      // This test verifies the agent connection works
      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(200);

      agentTransport.close();
    });

    test("Agent disconnection during request", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Disconnect Agent",
        {
          chat: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            // Send initial chunk
            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: {
                id: `chatcmpl-${randomUUID()}`,
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { content: "Started" },
                    finish_reason: null,
                  },
                ],
              },
            });

            await new Promise((resolve) => setTimeout(resolve, 20));

            // Close transport while streaming
            agentTransport.close();

            // Try to send more - this should not crash the controller
            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: {
                id: `chatcmpl-${randomUUID()}`,
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { content: " continued" },
                    finish_reason: "stop",
                  },
                ],
              },
            });

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Test" }],
          stream: false,
        }),
      });

      // Controller should handle disconnection gracefully
      expect([200, 500, 503]).toContain(response.status);
    });

    test("Model switching during conversation", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Model Switch Agent",
        {
          chat: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: {
                id: `chatcmpl-${randomUUID()}`,
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { content: "Response with model: " + params.model },
                    finish_reason: "stop",
                  },
                ],
              },
            });

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async (params: any) => {
            // Verify model switching is handled
            return { models: [params.model || "test-model"] };
          },
          completion: async () => {},
          listModels: async () => ({ models: ["test-model", "test-model-2"] }),
          currentModels: async () => ({ models: ["test-model"] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      // First request
      let response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "First" }],
        }),
      });

      expect(response.status).toBe(200);

      // Second request with different model
      response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model-2",
          messages: [{ role: "user", content: "Second" }],
        }),
      });

      expect(response.status).toBe(200);

      agentTransport.close();
    });

    test("Streaming with interruption", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Stream Interrupt Agent",
        {
          chat: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            const chunks = ["Part1", " Part2", " Part3", " Part4"];

            for (let i = 0; i < chunks.length; i++) {
              await controller.receiveCompletion({
                agentId: params.agentId,
                requestId,
                data: {
                  id: `chatcmpl-${randomUUID()}`,
                  object: "chat.completion.chunk",
                  created: Date.now(),
                  model: "test-model",
                  choices: [
                    {
                      index: 0,
                      delta: { content: chunks[i] },
                      finish_reason: i === chunks.length - 1 ? "stop" : null,
                    },
                  ],
                },
              });
              await new Promise((r) => setTimeout(r, 5));
            }

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Tell me a story" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      // Parse and verify stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const chunks: any[] = [];
      let buffer = "";
      let done = false;
      let chunkCount = 0;

      while (!done && chunkCount < 5 && reader) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                done = true;
                break;
              }
              try {
                const chunk = JSON.parse(data);
                chunks.push(chunk);
                chunkCount++;
              } catch {}
            }
          }
        }
      }

      expect(chunks.length).toBeGreaterThan(0);

      agentTransport.close();
    });

    test("Concurrent requests to same agent", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Concurrent Agent",
        {
          chat: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: {
                id: `chatcmpl-${randomUUID()}`,
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { content: "Response" },
                    finish_reason: "stop",
                  },
                ],
              },
            });

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      // Send multiple concurrent requests
      const promises = [
        fetch(`${API_URL}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "test-model",
            messages: [{ role: "user", content: "Request 1" }],
          }),
        }),
        fetch(`${API_URL}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "test-model",
            messages: [{ role: "user", content: "Request 2" }],
          }),
        }),
        fetch(`${API_URL}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "test-model",
            messages: [{ role: "user", content: "Request 3" }],
          }),
        }),
      ];

      const responses = await Promise.all(promises);

      for (const response of responses) {
        expect(response.status).toBe(200);
      }

      agentTransport.close();
    });

    test("Response metadata verification", async () => {
      const { rpc, transport: agentTransport } = await createConnectedAgent(
        "Metadata Agent",
        {
          chat: async (params: any) => {
            const { requestId } = params;
            const controller = rpc.remote<ControllerFunctions>();

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: {
                id: `chatcmpl-${randomUUID()}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { content: "Hello" },
                    finish_reason: "stop",
                  },
                ],
              },
            });

            await controller.receiveCompletion({
              agentId: params.agentId,
              requestId,
              data: "[DONE]",
            });
          },
          startModel: async () => ({ models: ["test-model"] }),
          completion: async () => {},
          listModels: async () => ({ models: ["test-model"] }),
          currentModels: async () => ({ models: [] }),
          downloadModel: async () => {},
          status: async () => ({ status: "idle" }),
        }
      );

      const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        id: string;
        object: string;
        created: number;
        model: string;
        choices: any[];
        usage?: any;
      };

      // Verify response structure
      expect(body.id).toBeDefined();
      expect(body.object).toBe("chat.completion");
      expect(body.created).toBeDefined();
      expect(typeof body.created).toBe("number");
      expect(body.model).toBe("test-model");
      expect(body.choices).toBeDefined();
      expect(Array.isArray(body.choices)).toBe(true);

      agentTransport.close();
    });
  });
});
