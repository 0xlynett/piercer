import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";
import { RPC, WebSocketTransport } from "@piercer/rpc";
import {
  parseSSEStream,
  createDummyAgent,
  closeAllTrackedTransports,
} from "./shared/setup";
import type { ControllerFunctions } from "../src/rpc-types";
import { createServerInstance } from "../src/module";

describe("OpenAI API - Tool Calls", () => {
  let server: any;
  let container: any;
  let rpc: RPC<ControllerFunctions>;
  let transport: WebSocketTransport;
  let API_URL: string;
  let WS_URL: string;

  // Generate unique test database path for isolation
  const TEST_DB = `/tmp/test-tools-${crypto.randomUUID()}.db`;

  afterEach(async () => {
    // Close transport after each test to prevent interference
    if (transport) {
      transport.close();
      transport = undefined as any;
    }
  });

  beforeAll(async () => {
    // Create isolated server instance with test-specific configuration
    const { server: srv, container: cont } = createServerInstance({
      databasePath: TEST_DB,
      port: 1535,
      apiKey: "",
      agentSecretKey: "",
      logLevel: "error", // Reduce noise in tests
    });

    server = srv;
    container = cont;

    const port = server.port;
    API_URL = `http://127.0.0.1:${port}`;
    WS_URL = `ws://127.0.0.1:${port}/ws`;

    // Create model mapping for tool-model
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

  afterAll(async () => {
    // Delete model mapping
    try {
      await fetch(`${API_URL}/management/mappings/tool-model`, {
        method: "DELETE",
      });
    } catch {}

    // Close all tracked agent transports
    closeAllTrackedTransports();

    // Shutdown container and stop server for proper cleanup
    if (container) {
      await container.shutdown();
    }
    if (server) server.stop();

    // Clean up test database file
    try {
      Bun.file(TEST_DB).delete();
    } catch {}
  });

  test("Chat Completion with Tool Calls (non-streaming)", async () => {
    // 1. Setup Dummy Agent that returns tool calls
    const dummyAgent = await createDummyAgent(
      WS_URL,
      "tool-agent-1",
      "Tool Agent 1",
      "tool-model",
      async (params, rpc) => {
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
      }
    );

    transport = dummyAgent.transport;
    rpc = dummyAgent.rpc;

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
    const dummyAgent = await createDummyAgent(
      WS_URL,
      "tool-agent-streaming",
      "Tool Agent Streaming",
      "tool-model",
      async (params, rpc) => {
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
      }
    );

    transport = dummyAgent.transport;
    rpc = dummyAgent.rpc;

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
    const chunks = await parseSSEStream(response);

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
});
