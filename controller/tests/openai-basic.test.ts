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
import { createServerInstance } from "../src/index";

describe("OpenAI API - Basic Chat Completion", () => {
  let server: any;
  let container: any;
  let rpc: RPC<any>;
  let transport: WebSocketTransport;
  let API_URL: string;
  let WS_URL: string;

  // Generate unique test database path for isolation
  const TEST_DB = `/tmp/test-basic-${crypto.randomUUID()}.db`;

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
      port: 1533,
      apiKey: "",
      agentSecretKey: "",
      logLevel: "error", // Reduce noise in tests
    });

    server = srv;
    container = cont;

    const port = server.port;
    API_URL = `http://127.0.0.1:${port}`;
    WS_URL = `ws://127.0.0.1:${port}/ws`;

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
  });

  afterAll(async () => {
    // Delete model mapping
    try {
      await fetch(`${API_URL}/management/mappings/test-model`, {
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

  test("Chat Completion with Streaming (non-streaming mode)", async () => {
    // 1. Setup Dummy Agent
    const dummyAgent = await createDummyAgent(
      WS_URL,
      "dummy-agent",
      "Dummy Agent",
      "test-model",
      async (params, rpc) => {
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
      }
    );

    transport = dummyAgent.transport;
    rpc = dummyAgent.rpc;

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
    const dummyAgent = await createDummyAgent(
      WS_URL,
      "dummy-agent-streaming",
      "Dummy Agent Streaming",
      "test-model",
      async (params, rpc) => {
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
      }
    );

    transport = dummyAgent.transport;
    rpc = dummyAgent.rpc;

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
    const chunks = await parseSSEStream(response);

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
});
