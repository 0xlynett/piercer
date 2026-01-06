import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RPC, WebSocketTransport, type Transport } from "@piercer/rpc";
import type { AgentFunctions, ControllerFunctions } from "../src/rpc-types";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";

// Set environment variables before importing the app
const TEST_DB = `./test-${randomUUID()}.db`;
process.env.DATABASE_PATH = TEST_DB;
process.env.PORT = "0"; // Random port

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
});
