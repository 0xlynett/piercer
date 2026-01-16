import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RPC, WebSocketTransport, type Transport } from "@piercer/rpc";
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
  let rpc: RPC<AgentFunctions>;
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

    // Create model mappings
    const mappingsRes = await fetch(`${API_URL}/management/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_name: "test-model",
        filename: "test-model",
      }),
    });

    if (!mappingsRes.ok) {
      const text = await mappingsRes.text();
      throw new Error(`Failed to create test-model mapping: ${text}`);
    }

    const toolRes = await fetch(`${API_URL}/management/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_name: "tool-model",
        filename: "tool-model",
      }),
    });

    if (!toolRes.ok) {
      const text = await toolRes.text();
      throw new Error(`Failed to create tool-model mapping: ${text}`);
    }
  });

  afterAll(() => {
    if (transport) transport.close();
    if (server) server.stop();
    try {
      Bun.file(TEST_DB).delete();
    } catch {}
  });

  test("Chat Completion with Streaming", async () => {
    // 1. Setup Dummy Agent
    transport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": "dummy-agent",
        "agent-name": "Dummy Agent",
        "agent-installed-models": "test-model",
      },
    });

    rpc = new RPC(transport);

    // Expose Agent Functions
    rpc.expose({
      chat: async (params: any) => {
        console.log("Dummy Agent: chat called", params);
        const { requestId } = params;
        const controller = rpc.remote<ControllerFunctions>();

        // Stream chunks
        const chunks = ["Hello", " ", "World", "!"];
        for (const chunk of chunks) {
          await controller.receiveCompletion({
            agentId: "dummy-agent",
            requestId,
            data: {
              id: "chatcmpl-123",
              object: "chat.completion.chunk",
              created: Date.now(),
              model: "test-model",
              choices: [
                {
                  index: 0,
                  delta: { content: chunk },
                  finish_reason: null,
                },
              ],
            },
          });
          await new Promise((r) => setTimeout(r, 10)); // Small delay
        }

        // Send DONE
        await controller.receiveCompletion({
          agentId: "dummy-agent",
          requestId,
          data: "[DONE]",
        });
      },
      startModel: async (params: any) => {
        console.log("Dummy Agent: startModel called", params);
        return { models: ["test-model"] };
      },
      // Implement other required methods to avoid errors if called
      completion: async () => {},
      listModels: async () => ({ models: ["test-model"] }),
      currentModels: async () => ({ models: [] }),
      downloadModel: async () => {},
      status: async () => ({ status: "idle" }),
    });

    // Wait for connection
    await new Promise<void>((resolve) => {
      transport.on("open", () => resolve());
    });

    // 2. Send Request
    console.log("Sending chat completion request...");
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      }),
    });
    console.log("Received response status:", response.status);

    expect(response.status).toBe(200);
    const body = await response.json();
    console.log("Response body:", body);
    expect((body as any).choices[0].message.content).toBe("Hello World!");
  });

  test("Chat Completion with Streaming (stream: true)", async () => {
    // 1. Setup Dummy Agent
    transport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": "dummy-agent-streaming",
        "agent-name": "Dummy Agent Streaming",
        "agent-installed-models": "test-model",
      },
    });

    rpc = new RPC(transport);

    // Expose Agent Functions
    rpc.expose({
      chat: async (params: any) => {
        console.log("Dummy Agent: chat called", params);
        const { requestId } = params;
        const controller = rpc.remote<ControllerFunctions>();

        // Stream chunks
        const chunks = ["Hello", " ", "World", "!"];
        for (const chunk of chunks) {
          await controller.receiveCompletion({
            agentId: "dummy-agent-streaming",
            requestId,
            data: {
              id: "chatcmpl-123",
              object: "chat.completion.chunk",
              created: Date.now(),
              model: "test-model",
              choices: [
                {
                  index: 0,
                  delta: { content: chunk },
                  finish_reason: null,
                },
              ],
            },
          });
          await new Promise((r) => setTimeout(r, 10)); // Small delay
        }

        // Send DONE
        await controller.receiveCompletion({
          agentId: "dummy-agent-streaming",
          requestId,
          data: "[DONE]",
        });
      },
      startModel: async (params: any) => {
        console.log("Dummy Agent: startModel called", params);
        return { models: ["test-model"] };
      },
      // Implement other required methods to avoid errors if called
      completion: async () => {},
      listModels: async () => ({ models: ["test-model"] }),
      currentModels: async () => ({ models: [] }),
      downloadModel: async () => {},
      status: async () => ({ status: "idle" }),
    });

    // Wait for connection
    await new Promise<void>((resolve) => {
      transport.on("open", () => resolve());
    });

    // 2. Send Request with stream: true
    console.log("Sending streaming chat completion request...");
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      }),
    });
    console.log("Received streaming response status:", response.status);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    // 3. Parse SSE stream
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

        // Split by double newline (SSE message separator)
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6); // Remove "data: " prefix

            if (data === "[DONE]") {
              console.log("Received [DONE] marker");
              done = true;
              break;
            }

            try {
              const chunk = JSON.parse(data);
              console.log("Received chunk:", chunk);
              chunks.push(chunk);
            } catch (e) {
              console.error("Failed to parse chunk:", data);
            }
          }
        }
      }
    }

    // 4. Verify chunks
    console.log("Total chunks received:", chunks.length);
    expect(chunks.length).toBe(4); // "Hello", " ", "World", "!"

    // Verify structure of first chunk
    expect(chunks[0]).toHaveProperty("id");
    expect(chunks[0]).toHaveProperty("object", "chat.completion.chunk");
    expect(chunks[0]).toHaveProperty("created");
    expect(chunks[0]).toHaveProperty("model", "test-model");
    expect(chunks[0]).toHaveProperty("choices");
    expect(chunks[0].choices[0]).toHaveProperty("index", 0);
    expect(chunks[0].choices[0]).toHaveProperty("delta");
    expect(chunks[0].choices[0].delta).toHaveProperty("content", "Hello");
    expect(chunks[0].choices[0]).toHaveProperty("finish_reason", null);

    // Collect all content
    const fullContent = chunks
      .map((chunk) => chunk.choices?.[0]?.delta?.content || "")
      .join("");
    console.log("Full content:", fullContent);
    expect(fullContent).toBe("Hello World!");
  });

  test("Chat Completion with Tool Calls (non-streaming)", async () => {
    // 1. Setup Dummy Agent that returns tool calls
    transport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": "tool-agent-1",
        "agent-name": "Tool Agent 1",
        "agent-installed-models": "tool-model",
      },
    });

    rpc = new RPC(transport);

    // Expose Agent Functions
    rpc.expose({
      chat: async (params: any) => {
        console.log("Dummy Agent: chat called with tool request", params);
        const { requestId } = params;
        const controller = rpc.remote<ControllerFunctions>();

        // Simulate agent deciding to call a tool
        await controller.receiveCompletion({
          agentId: "tool-agent-1",
          requestId,
          data: {
            id: "chatcmpl-tool-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call_123",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: "",
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
        });

        // Send partial arguments
        await controller.receiveCompletion({
          agentId: "tool-agent-1",
          requestId,
          data: {
            id: "chatcmpl-tool-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: "call_123",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: '{"loc',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
        });

        // Send remaining arguments and finish
        await controller.receiveCompletion({
          agentId: "tool-agent-1",
          requestId,
          data: {
            id: "chatcmpl-tool-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: "call_123",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: 'ation":"New York"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        });

        // Send DONE
        await controller.receiveCompletion({
          agentId: "tool-agent-1",
          requestId,
          data: "[DONE]",
        });
      },
      startModel: async (params: any) => {
        console.log("Dummy Agent: startModel called", params);
        return { models: ["tool-model"] };
      },
      completion: async () => {},
      listModels: async () => ({ models: ["tool-model"] }),
      currentModels: async () => ({ models: [] }),
      downloadModel: async () => {},
      status: async () => ({ status: "idle" }),
    });

    // Wait for connection
    await new Promise<void>((resolve) => {
      transport.on("open", () => resolve());
    });

    // 2. Send request with tools
    console.log("Sending chat completion request with tools...");
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tool-model",
        messages: [
          { role: "user", content: "What's the weather in New York?" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "The city and state, e.g. San Francisco, CA",
                  },
                },
                required: ["location"],
              },
            },
          },
        ],
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    console.log("Tool call response body:", body);

    // Verify response structure
    expect((body as any).id).toBe("chatcmpl-tool-123");
    expect(body as any).toHaveProperty("object", "chat.completion");
    expect(body as any).toHaveProperty("model", "tool-model");
    expect(body as any).toHaveProperty("choices");
    expect((body as any).choices).toHaveLength(1);

    // Verify tool call in response
    const choice = (body as any).choices[0];
    expect(choice).toHaveProperty("message");
    expect(choice.message).toHaveProperty("role", "assistant");
    expect(choice.message).toHaveProperty("tool_calls");
    expect(choice.message.tool_calls).toHaveLength(1);

    const toolCall = choice.message.tool_calls[0];
    expect(toolCall).toHaveProperty("id", "call_123");
    expect(toolCall).toHaveProperty("type", "function");
    expect(toolCall.function).toHaveProperty("name", "get_weather");
    expect(toolCall.function).toHaveProperty(
      "arguments",
      '{"location":"New York"}'
    );
    expect(choice).toHaveProperty("finish_reason", "tool_calls");
  });

  test("Chat Completion with Tool Calls (streaming)", async () => {
    // 1. Setup Dummy Agent that returns tool calls via stream
    transport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": "tool-agent-streaming",
        "agent-name": "Tool Agent Streaming",
        "agent-installed-models": "tool-model",
      },
    });

    rpc = new RPC(transport);

    // Expose Agent Functions
    rpc.expose({
      chat: async (params: any) => {
        console.log("Dummy Agent: streaming tool call", params);
        const { requestId } = params;
        const controller = rpc.remote<ControllerFunctions>();

        // Stream chunks with tool calls
        const chunks = [
          {
            id: "chatcmpl-tool-stream-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: { role: "assistant" },
                finish_reason: null,
              },
            ],
          },
          {
            id: "chatcmpl-tool-stream-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: "call_456",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: "",
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            id: "chatcmpl-tool-stream-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: "call_456",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: '{"location":',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            id: "chatcmpl-tool-stream-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: "call_456",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: '"London"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ];

        for (const chunk of chunks) {
          await controller.receiveCompletion({
            agentId: "tool-agent-streaming",
            requestId,
            data: chunk,
          });
          await new Promise((r) => setTimeout(r, 10));
        }

        // Send DONE
        await controller.receiveCompletion({
          agentId: "tool-agent-streaming",
          requestId,
          data: "[DONE]",
        });
      },
      startModel: async (params: any) => ({ models: ["tool-model"] }),
      completion: async () => {},
      listModels: async () => ({ models: ["tool-model"] }),
      currentModels: async () => ({ models: [] }),
      downloadModel: async () => {},
      status: async () => ({ status: "idle" }),
    });

    // Wait for connection
    await new Promise<void>((resolve) => {
      transport.on("open", () => resolve());
    });

    // 2. Send streaming request with tools
    console.log("Sending streaming chat completion request with tools...");
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tool-model",
        messages: [{ role: "user", content: "What's the weather in London?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "The city and state, e.g. San Francisco, CA",
                  },
                },
                required: ["location"],
              },
            },
          },
        ],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    // 3. Parse SSE stream
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
            } catch (e) {
              console.error("Failed to parse chunk:", data);
            }
          }
        }
      }
    }

    // 4. Verify chunks
    console.log("Total streaming chunks received:", chunks.length);
    expect(chunks.length).toBeGreaterThan(0);

    // Find the chunk with tool_calls
    const toolCallChunk = chunks.find(
      (chunk) => chunk.choices?.[0]?.delta?.tool_calls
    );
    expect(toolCallChunk).toBeDefined();

    const toolCall = toolCallChunk.choices[0].delta.tool_calls[0];
    expect(toolCall).toHaveProperty("id", "call_456");
    expect(toolCall).toHaveProperty("type", "function");
    expect(toolCall.function).toHaveProperty("name", "get_weather");

    // Verify final chunk has finish_reason
    const finalChunk = chunks[chunks.length - 1];
    expect(finalChunk.choices[0]).toHaveProperty("finish_reason", "tool_calls");
  });

  test("Chat Completion with Tool Execution and Continuation", async () => {
    // 1. Setup Dummy Agent that handles tool execution flow
    transport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": "tool-agent-exec",
        "agent-name": "Tool Agent Exec",
        "agent-installed-models": "tool-model",
      },
    });

    rpc = new RPC(transport);

    // Expose Agent Functions
    rpc.expose({
      chat: async (params: any) => {
        console.log("Dummy Agent: tool execution flow", params);
        const { requestId } = params;
        const controller = rpc.remote<ControllerFunctions>();

        // First, return a tool call
        await controller.receiveCompletion({
          agentId: "tool-agent-exec",
          requestId,
          data: {
            id: "chatcmpl-tool-exec-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: "call_exec_1",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: '{"location":"Paris"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        });

        // Send DONE
        await controller.receiveCompletion({
          agentId: "tool-agent-exec",
          requestId,
          data: "[DONE]",
        });
      },
      startModel: async (params: any) => ({ models: ["tool-model"] }),
      completion: async () => {},
      listModels: async () => ({ models: ["tool-model"] }),
      currentModels: async () => ({ models: [] }),
      downloadModel: async () => {},
      status: async () => ({ status: "idle" }),
    });

    // Wait for connection
    await new Promise<void>((resolve) => {
      transport.on("open", () => resolve());
    });

    // 2. Send initial request with tools
    console.log("Sending initial tool request...");
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tool-model",
        messages: [{ role: "user", content: "What's the weather in Paris?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "The city and state",
                  },
                },
                required: ["location"],
              },
            },
          },
        ],
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const initialBody = await response.json();
    console.log("Initial response:", initialBody);

    // Verify initial tool call
    expect((initialBody as any).choices[0].message.tool_calls).toHaveLength(1);
    const toolCallId = (initialBody as any).choices[0].message.tool_calls[0].id;

    // 3. Send tool result back (continuation)
    // Close the first transport and create a new one for the continuation
    transport.close();

    transport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": "tool-agent-exec-cont",
        "agent-name": "Tool Agent Exec Cont",
        "agent-installed-models": "tool-model",
      },
    });

    rpc = new RPC(transport);

    // Expose Agent Functions for continuation
    rpc.expose({
      chat: async (params: any) => {
        console.log("Dummy Agent: continuation with tool result", params);
        const { requestId } = params;
        const controller = rpc.remote<ControllerFunctions>();

        // Return final answer after tool result
        await controller.receiveCompletion({
          agentId: "tool-agent-exec-cont",
          requestId,
          data: {
            id: "chatcmpl-tool-exec-124",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: { content: "The weather in Paris is sunny and 22°C." },
                finish_reason: "stop",
              },
            ],
          },
        });

        // Send DONE
        await controller.receiveCompletion({
          agentId: "tool-agent-exec-cont",
          requestId,
          data: "[DONE]",
        });
      },
      startModel: async (params: any) => ({ models: ["tool-model"] }),
      completion: async () => {},
      listModels: async () => ({ models: ["tool-model"] }),
      currentModels: async () => ({ models: [] }),
      downloadModel: async () => {},
      status: async () => ({ status: "idle" }),
    });

    // Wait for connection
    await new Promise<void>((resolve) => {
      transport.on("open", () => resolve());
    });

    // Send continuation request with tool result
    console.log("Sending continuation with tool result...");
    const continuationResponse = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tool-model",
        messages: [
          { role: "user", content: "What's the weather in Paris?" },
          {
            role: "assistant",
            tool_calls: [
              {
                id: toolCallId,
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"location":"Paris"}',
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: toolCallId,
            content: '{"temperature": "22°C", "condition": "sunny"}',
          },
        ],
        stream: false,
      }),
    });

    expect(continuationResponse.status).toBe(200);
    const continuationBody = await continuationResponse.json();
    console.log("Continuation response:", continuationBody);

    // Verify final response
    expect((continuationBody as any).choices[0].message.content).toBe(
      "The weather in Paris is sunny and 22°C."
    );
    expect((continuationBody as any).choices[0]).toHaveProperty(
      "finish_reason",
      "stop"
    );
  });

  test("Chat Completion with Multiple Tool Calls", async () => {
    // 1. Setup Dummy Agent that returns multiple tool calls
    transport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": "tool-agent-multi",
        "agent-name": "Tool Agent Multi",
        "agent-installed-models": "tool-model",
      },
    });

    rpc = new RPC(transport);

    // Expose Agent Functions
    rpc.expose({
      chat: async (params: any) => {
        console.log("Dummy Agent: multiple tool calls", params);
        const { requestId } = params;
        const controller = rpc.remote<ControllerFunctions>();

        // Return multiple tool calls
        await controller.receiveCompletion({
          agentId: "tool-agent-multi",
          requestId,
          data: {
            id: "chatcmpl-multi-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: "call_a",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: '{"location":"Tokyo"}',
                      },
                    },
                    {
                      id: "call_b",
                      type: "function",
                      function: {
                        name: "get_time",
                        arguments: '{"timezone":"Asia/Tokyo"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        });

        // Send DONE
        await controller.receiveCompletion({
          agentId: "tool-agent-multi",
          requestId,
          data: "[DONE]",
        });
      },
      startModel: async (params: any) => ({ models: ["tool-model"] }),
      completion: async () => {},
      listModels: async () => ({ models: ["tool-model"] }),
      currentModels: async () => ({ models: [] }),
      downloadModel: async () => {},
      status: async () => ({ status: "idle" }),
    });

    // Wait for connection
    await new Promise<void>((resolve) => {
      transport.on("open", () => resolve());
    });

    // 2. Send request with tools
    console.log("Sending request with multiple tools...");
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tool-model",
        messages: [
          { role: "user", content: "What's the weather and time in Tokyo?" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string" },
                },
                required: ["location"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "get_time",
              description: "Get the current time for a timezone",
              parameters: {
                type: "object",
                properties: {
                  timezone: { type: "string" },
                },
                required: ["timezone"],
              },
            },
          },
        ],
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    console.log("Multiple tool calls response:", body);

    // Verify multiple tool calls in response
    const toolCalls = (body as any).choices[0].message.tool_calls;
    expect(toolCalls).toHaveLength(2);

    expect(toolCalls[0]).toHaveProperty("id", "call_a");
    expect(toolCalls[0].function).toHaveProperty("name", "get_weather");
    expect(toolCalls[0].function).toHaveProperty(
      "arguments",
      '{"location":"Tokyo"}'
    );

    expect(toolCalls[1]).toHaveProperty("id", "call_b");
    expect(toolCalls[1].function).toHaveProperty("name", "get_time");
    expect(toolCalls[1].function).toHaveProperty(
      "arguments",
      '{"timezone":"Asia/Tokyo"}'
    );

    expect((body as any).choices[0]).toHaveProperty(
      "finish_reason",
      "tool_calls"
    );
  });

  test("Chat Completion with Invalid Tool Call (error handling)", async () => {
    // 1. Setup Dummy Agent
    transport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": "tool-agent-error",
        "agent-name": "Tool Agent Error",
        "agent-installed-models": "tool-model",
      },
    });

    rpc = new RPC(transport);

    // Expose Agent Functions
    rpc.expose({
      chat: async (params: any) => {
        const { requestId } = params;
        const controller = rpc.remote<ControllerFunctions>();

        // Return a tool call with non-existent function
        await controller.receiveCompletion({
          agentId: "tool-agent-error",
          requestId,
          data: {
            id: "chatcmpl-error-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: "call_invalid",
                      type: "function",
                      function: {
                        name: "non_existent_function",
                        arguments: "{}",
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        });

        await controller.receiveCompletion({
          agentId: "tool-agent-error",
          requestId,
          data: "[DONE]",
        });
      },
      startModel: async (params: any) => ({ models: ["tool-model"] }),
      completion: async () => {},
      listModels: async () => ({ models: ["tool-model"] }),
      currentModels: async () => ({ models: [] }),
      downloadModel: async () => {},
      status: async () => ({ status: "idle" }),
    });

    // Wait for connection
    await new Promise<void>((resolve) => {
      transport.on("open", () => resolve());
    });

    // 2. Send request with tools
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tool-model",
        messages: [{ role: "user", content: "Do something invalid" }],
        tools: [
          {
            type: "function",
            function: {
              name: "non_existent_function",
              description: "This function doesn't exist",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        stream: false,
      }),
    });

    // Should still return 200 with the tool call (validation happens client-side)
    expect(response.status).toBe(200);
    const body = await response.json();

    // The tool call should be returned even if invalid
    expect((body as any).choices[0].message.tool_calls).toHaveLength(1);
    expect((body as any).choices[0].message.tool_calls[0].function.name).toBe(
      "non_existent_function"
    );
  });

  test("Chat Completion with Empty Tool Arguments", async () => {
    // Test tool call with empty arguments string
    transport = new WebSocketTransport(WS_URL, {
      headers: {
        "agent-id": "tool-agent-empty",
        "agent-name": "Tool Agent Empty",
        "agent-installed-models": "tool-model",
      },
    });

    rpc = new RPC(transport);

    rpc.expose({
      chat: async (params: any) => {
        const { requestId } = params;
        const controller = rpc.remote<ControllerFunctions>();

        await controller.receiveCompletion({
          agentId: "tool-agent-empty",
          requestId,
          data: {
            id: "chatcmpl-empty-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "tool-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: "call_empty",
                      type: "function",
                      function: {
                        name: "no_args_function",
                        arguments: "",
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        });

        await controller.receiveCompletion({
          agentId: "tool-agent-empty",
          requestId,
          data: "[DONE]",
        });
      },
      startModel: async (params: any) => ({ models: ["tool-model"] }),
      completion: async () => {},
      listModels: async () => ({ models: ["tool-model"] }),
      currentModels: async () => ({ models: [] }),
      downloadModel: async () => {},
      status: async () => ({ status: "idle" }),
    });

    await new Promise<void>((resolve) => {
      transport.on("open", () => resolve());
    });

    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tool-model",
        messages: [{ role: "user", content: "Call a function with no args" }],
        tools: [
          {
            type: "function",
            function: {
              name: "no_args_function",
              description: "A function that takes no arguments",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect((body as any).choices[0].message.tool_calls).toHaveLength(1);
    expect(
      (body as any).choices[0].message.tool_calls[0].function.arguments
    ).toBe("");
  });
});
