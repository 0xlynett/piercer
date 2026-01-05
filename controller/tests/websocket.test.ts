import { test, expect, beforeEach, afterEach, describe, mock } from "bun:test";
import { PiercerWebSocketHandler } from "../src/apis/websocket";
import { AgentRPCService } from "../src/services/agent-rpc";
import { BunDatabase } from "../src/services/db";
import { PinoLogger } from "../src/services/logger";
import { AgentManager } from "../src/services/agents";
import { BunTransport } from "../src/utils/bun-transport";
import type { Db } from "../src/services/db";
import type { Logger } from "../src/services/logger";
import { randomUUID } from "crypto";

describe("PiercerWebSocketHandler", () => {
  let db: Db;
  let logger: Logger;
  let agentManager: AgentManager;
  let agentRPCService: AgentRPCService;
  let wsHandler: PiercerWebSocketHandler;
  let transport: BunTransport;
  let testDbPath: string;
  let mockRpc: any;

  beforeEach(() => {
    testDbPath = `./test-${randomUUID()}.db`;
    db = new BunDatabase(testDbPath);
    logger = new PinoLogger({ level: "info" });
    agentManager = new AgentManager(db, logger);
    agentRPCService = new AgentRPCService(agentManager, logger);
    transport = new BunTransport();
    wsHandler = new PiercerWebSocketHandler(
      db,
      logger,
      agentManager,
      transport,
      agentRPCService
    );

    mockRpc = {
      remote: mock((agentId) => ({
        completion: mock(async () => ({ result: "completion_result" })),
        chat: mock(async () => ({ result: "chat_result" })),
        listModels: mock(async () => ({ models: [] })),
        currentModels: mock(async () => ({ models: [] })),
        startModel: mock(async () => ({ models: [] })),
        downloadModel: mock(async () => ({
          filename: "downloaded_model.gguf",
        })),
        status: mock(async () => ({ status: "ready" })),
      })),
    };

    agentRPCService.setRpc(mockRpc);
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
    expect(typeof api.error).toBe("function");
    expect(typeof api.receiveCompletion).toBe("function");
    // These should NOT be in the exposed API anymore
    expect((api as any).completion).toBeUndefined();
    expect((api as any).chat).toBeUndefined();
  });

  test("should handle controller-to-agent procedures", async () => {
    // Test completion procedure
    const completionResult = await agentRPCService.completion({
      agentId: "test-agent",
      prompt: "Hello",
    });
    expect(completionResult).toBeDefined();
    expect(completionResult.result).toBe("completion_result");
    expect(mockRpc.remote).toHaveBeenCalledWith("test-agent");

    // Test chat procedure
    const chatResult = await agentRPCService.chat({
      agentId: "test-agent",
      messages: [],
    });
    expect(chatResult).toBeDefined();
    expect(chatResult.result).toBe("chat_result");

    // Test list models procedure
    const modelsResult = await agentRPCService.listModels({
      agentId: "test-agent",
    });
    expect(modelsResult).toBeDefined();
    expect(modelsResult.models).toEqual([]);

    // Test current models procedure
    const currentModelsResult = await agentRPCService.currentModels({
      agentId: "test-agent",
    });
    expect(currentModelsResult).toBeDefined();
    expect(currentModelsResult.models).toEqual([]);

    // Test start model procedure
    const startModelResult = await agentRPCService.startModel({
      agentId: "test-agent",
      model: "llama-7b",
    });
    expect(startModelResult).toBeDefined();
    expect(startModelResult.models).toEqual([]);

    // Test download model procedure
    const downloadModelResult = await agentRPCService.downloadModel({
      agentId: "test-agent",
      url: "https://example.com/model.gguf",
      filename: "model.gguf",
    });
    expect(downloadModelResult).toBeDefined();
    expect(downloadModelResult.filename).toBe("downloaded_model.gguf");

    // Test status procedure
    const statusResult = await agentRPCService.status({
      agentId: "test-agent",
    });
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
