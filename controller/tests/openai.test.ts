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
});
