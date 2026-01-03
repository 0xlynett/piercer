import { test, expect, beforeEach, afterEach } from "bun:test";
import { KkrpcWebSocketHandler } from "../src/apis/websocket";
import { BunDatabase } from "../src/services/db";
import { PinoLogger } from "../src/services/logger";
import type { Db } from "../src/services/db";
import type { Logger } from "../src/services/logger";
import { randomUUID } from "crypto";

test("KkrpcWebSocketHandler", () => {
  let db: Db;
  let logger: Logger;
  let wsHandler: KkrpcWebSocketHandler;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = `./test-${randomUUID()}.db`;
    db = new BunDatabase(testDbPath);
    logger = new PinoLogger({ level: "info" });
    wsHandler = new KkrpcWebSocketHandler(db, logger);
  });

  afterEach(() => {
    wsHandler.shutdown();
    db.close();
    try {
      Bun.file(testDbPath)?.delete();
    } catch {
      // Ignore cleanup errors
    }
  });

  test("should initialize with empty connected agents", () => {
    const connectedAgents = wsHandler.getConnectedAgents();
    expect(connectedAgents).toHaveLength(0);
  });

  test("should check if agent is connected", () => {
    expect(wsHandler.isAgentConnected("non-existent-agent")).toBe(false);
  });

  test("should get agent info", () => {
    const agent = wsHandler.getAgent("non-existent-agent");
    expect(agent).toBeUndefined();
  });

  test("should get agent API", () => {
    const api = wsHandler.getAgentAPI();
    expect(api).toBeDefined();
    expect(typeof api.completion).toBe("function");
    expect(typeof api.chat).toBe("function");
    expect(typeof api.listModels).toBe("function");
    expect(typeof api.currentModels).toBe("function");
    expect(typeof api.startModel).toBe("function");
    expect(typeof api.downloadModel).toBe("function");
    expect(typeof api.status).toBe("function");
    expect(typeof api.error).toBe("function");
    expect(typeof api.receiveCompletion).toBe("function");
  });

  test("should handle controller-to-agent procedures", async () => {
    // Test completion procedure
    const completionResult = await wsHandler
      .getAgentAPI()
      .completion({ prompt: "Hello" });
    expect(completionResult).toBeDefined();
    expect(completionResult.result).toBe("completion_result");

    // Test chat procedure
    const chatResult = await wsHandler.getAgentAPI().chat({ messages: [] });
    expect(chatResult).toBeDefined();
    expect(chatResult.result).toBe("chat_result");

    // Test list models procedure
    const modelsResult = await wsHandler.getAgentAPI().listModels();
    expect(modelsResult).toBeDefined();
    expect(modelsResult.models).toEqual([]);

    // Test current models procedure
    const currentModelsResult = await wsHandler.getAgentAPI().currentModels();
    expect(currentModelsResult).toBeDefined();
    expect(currentModelsResult.models).toEqual([]);

    // Test start model procedure
    const startModelResult = await wsHandler
      .getAgentAPI()
      .startModel({ model: "llama-7b" });
    expect(startModelResult).toBeDefined();
    expect(startModelResult.models).toEqual([]);

    // Test download model procedure
    const downloadModelResult = await wsHandler.getAgentAPI().downloadModel({
      url: "https://example.com/model.gguf",
      filename: "model.gguf",
    });
    expect(downloadModelResult).toBeDefined();
    expect(downloadModelResult.filename).toBe("downloaded_model.gguf");

    // Test status procedure
    const statusResult = await wsHandler.getAgentAPI().status();
    expect(statusResult).toBeDefined();
    expect(statusResult.status).toBe("ready");
  });

  test("should handle agent-to-controller procedures", () => {
    // Test error procedure
    expect(() => {
      wsHandler.getAgentAPI().error({
        agentId: "test-agent",
        error: "Test error",
        context: { test: true },
      });
    }).not.toThrow();

    // Test receive completion procedure
    expect(() => {
      wsHandler.getAgentAPI().receiveCompletion({
        agentId: "test-agent",
        requestId: "req-123",
        data: { completion: "Hello world" },
      });
    }).not.toThrow();
  });

  test("should shutdown cleanly", () => {
    expect(() => {
      wsHandler.shutdown();
    }).not.toThrow();

    // After shutdown, should have no connected agents
    const connectedAgents = wsHandler.getConnectedAgents();
    expect(connectedAgents).toHaveLength(0);
  });
});
