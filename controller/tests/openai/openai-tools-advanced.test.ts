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
  createDummyAgent,
  closeAllTrackedTransports,
  trackTransport,
} from "./shared/setup";
import type { ControllerFunctions } from "../../src/rpc-types";

// Set environment variables BEFORE importing the app
const TEST_DB = `./test-tools-advanced-${crypto.randomUUID()}.db`;
process.env.DATABASE_PATH = TEST_DB;
process.env.PORT = "0"; // Random port
process.env.API_KEY = ""; // No API key required for tests
process.env.AGENT_SECRET_KEY = ""; // No agent secret key for tests

describe("OpenAI API - Advanced Tool Scenarios", () => {
  let server: any;
  let rpc: RPC<any>;
  let transport: WebSocketTransport;
  let API_URL: string;
  let WS_URL: string;

  afterEach(async () => {
    // Close transport after each test to prevent interference
    if (transport) {
      transport.close();
      transport = undefined as any;
    }
  });

  beforeAll(async () => {
    // Dynamic import to ensure env vars are picked up
    const mod = await import("../../src/index");
    server = mod.server;

    const port = server.port;
    const hostname = server.hostname;
    API_URL = `http://${hostname}:${port}`;
    WS_URL = `ws://${hostname}:${port}/ws`;

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

    if (server) server.stop();
    try {
      Bun.file(TEST_DB).delete();
    } catch {}
  });

  test("Chat Completion with Tool Execution and Continuation", async () => {
    // 1. Setup Dummy Agent that handles tool execution flow
    const dummyAgent = await createDummyAgent(
      WS_URL,
      "tool-agent-exec",
      "Tool Agent Exec",
      "tool-model",
      async (params, rpc) => {
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
      }
    );

    transport = dummyAgent.transport;
    rpc = dummyAgent.rpc;

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

    // Track this transport for cleanup
    trackTransport(transport);

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
    const dummyAgent = await createDummyAgent(
      WS_URL,
      "tool-agent-multi",
      "Tool Agent Multi",
      "tool-model",
      async (params, rpc) => {
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
      }
    );

    transport = dummyAgent.transport;
    rpc = dummyAgent.rpc;

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
    const dummyAgent = await createDummyAgent(
      WS_URL,
      "tool-agent-error",
      "Tool Agent Error",
      "tool-model",
      async (params, rpc) => {
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
      }
    );

    transport = dummyAgent.transport;
    rpc = dummyAgent.rpc;

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
    const dummyAgent = await createDummyAgent(
      WS_URL,
      "tool-agent-empty",
      "Tool Agent Empty",
      "tool-model",
      async (params, rpc) => {
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
      }
    );

    transport = dummyAgent.transport;
    rpc = dummyAgent.rpc;

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
