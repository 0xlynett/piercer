import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";
import { RPC, WebSocketTransport } from "@piercer/rpc";
import OpenAI from "openai";
import { createDummyAgent, closeAllTrackedTransports } from "./shared/setup";
import type { ControllerFunctions } from "../src/rpc-types";
import { createServerInstance } from "../src/module";

describe("OpenAI API - Basic Chat Completion", () => {
  let server: any;
  let container: any;
  let rpc: RPC<ControllerFunctions>;
  let transport: WebSocketTransport;
  let API_URL: string;
  let WS_URL: string;

  // Generate unique test database path for isolation
  const TEST_DB = `/tmp/test-basic-${crypto.randomUUID()}.db`;

  function getClient() {
    return new OpenAI({
      baseURL: API_URL + "/v1",
      apiKey: "test-key",
      dangerouslyAllowBrowser: true,
    });
  }

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

    // 2. Send Request using OpenAI SDK
    console.log("Sending chat completion request...");
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      stream: false,
    });

    console.log("Response:", completion);
    expect(completion.choices[0]?.message?.content).toBe("Hello World!");
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

    // 2. Send streaming request using OpenAI SDK
    console.log("Sending streaming chat completion request...");
    const client = getClient();
    const stream = await client.chat.completions.create({
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      stream: true,
    });

    // 3. Collect chunks from stream
    const chunks: any[] = [];
    for await (const chunk of stream) {
      console.log("Received chunk:", chunk);
      chunks.push(chunk);
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
});
