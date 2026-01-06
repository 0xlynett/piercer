import { test, expect, beforeEach, describe, mock } from "bun:test";
import { AgentRPCService } from "../src/services/agent-rpc";
import { AgentManager } from "../src/services/agents";
import { PinoLogger } from "../src/services/logger";
import type { Logger } from "../src/services/logger";

describe("AgentRPCService", () => {
  let agentManager: AgentManager;
  let logger: Logger;
  let agentRPCService: AgentRPCService;
  let mockRpc: any;
  let mockStreamController: any;

  beforeEach(() => {
    // Mock Logger
    logger = {
      info: mock(),
      warn: mock(),
      error: mock(),
      debug: mock(),
      agentConnected: mock(),
      agentDisconnected: mock(),
      agentError: mock(),
      requestReceived: mock(),
      requestCompleted: mock(),
      requestFailed: mock(),
    } as unknown as Logger;

    // Mock AgentManager
    agentManager = {
      getStream: mock(),
      removeStream: mock(),
      setInstalledModels: mock(),
      addLoadedModel: mock(),
    } as unknown as AgentManager;

    // Mock RPC
    mockRpc = {
      remote: mock((agentId) => ({
        completion: mock(async () => ({ result: "completion_result" })),
        chat: mock(async () => ({ result: "chat_result" })),
        listModels: mock(async () => ({ models: ["model1"] })),
        currentModels: mock(async () => ({ models: ["model1"] })),
        startModel: mock(async () => ({ models: ["model1"] })),
        downloadModel: mock(async () => ({ filename: "model.gguf" })),
        status: mock(async () => ({ status: "ready" })),
      })),
    };

    // Mock Stream Controller
    mockStreamController = {
      enqueue: mock(),
      close: mock(),
      error: mock(),
    };

    agentRPCService = new AgentRPCService(agentManager, logger);
    agentRPCService.setRpc(mockRpc);
  });

  describe("receiveCompletion", () => {
    test("should write data to the correct stream", () => {
      (agentManager.getStream as any).mockReturnValue(mockStreamController);

      const params = {
        requestId: "req-123",
        data: { text: "Hello" },
      };

      agentRPCService.handleReceiveCompletion(params);

      expect(agentManager.getStream).toHaveBeenCalledWith("req-123");
      expect(mockStreamController.enqueue).toHaveBeenCalled();
      // Verify the data written contains the JSON string
      const callArgs = (mockStreamController.enqueue as any).mock.calls[0][0];
      const decoded = new TextDecoder().decode(callArgs);
      expect(decoded).toContain('data: {"text":"Hello"}\n\n');
    });

    test("should close stream on [DONE]", () => {
      (agentManager.getStream as any).mockReturnValue(mockStreamController);

      const params = {
        requestId: "req-123",
        data: "[DONE]",
      };

      agentRPCService.handleReceiveCompletion(params);

      expect(mockStreamController.enqueue).toHaveBeenCalled(); // Should write data: [DONE]
      expect(mockStreamController.close).toHaveBeenCalled();
      expect(agentManager.removeStream).toHaveBeenCalledWith("req-123");
    });

    test("should handle missing streams gracefully (log warning)", () => {
      (agentManager.getStream as any).mockReturnValue(undefined);

      const params = {
        requestId: "unknown-req",
        data: { text: "Hello" },
      };

      agentRPCService.handleReceiveCompletion(params);

      expect(logger.warn).toHaveBeenCalled();
      expect(mockStreamController.enqueue).not.toHaveBeenCalled();
    });

    test("should handle errors when writing to stream", () => {
      (agentManager.getStream as any).mockReturnValue(mockStreamController);
      mockStreamController.enqueue.mockImplementation(() => {
        throw new Error("Stream error");
      });

      const params = {
        requestId: "req-123",
        data: { text: "Hello" },
      };

      agentRPCService.handleReceiveCompletion(params);

      expect(logger.error).toHaveBeenCalled();
      expect(mockStreamController.error).toHaveBeenCalled();
      expect(agentManager.removeStream).toHaveBeenCalledWith("req-123");
    });
  });

  describe("completion / chat", () => {
    test("completion should call the underlying RPC client", async () => {
      const params = {
        agentId: "agent-1",
        prompt: "Hello",
        stream: true,
      };

      await agentRPCService.completion(params);

      expect(mockRpc.remote).toHaveBeenCalledWith("agent-1");
      // Get the mock returned by remote()
      const agentRpc = mockRpc.remote.mock.results[0].value;
      expect(agentRpc.completion).toHaveBeenCalledWith({
        prompt: "Hello",
        stream: true,
      });
    });

    test("chat should call the underlying RPC client", async () => {
      const params = {
        agentId: "agent-1",
        messages: [{ role: "user", content: "Hello" }],
      };

      await agentRPCService.chat(params);

      expect(mockRpc.remote).toHaveBeenCalledWith("agent-1");
      const agentRpc = mockRpc.remote.mock.results[0].value;
      expect(agentRpc.chat).toHaveBeenCalledWith({
        messages: [{ role: "user", content: "Hello" }],
      });
    });
  });

  describe("startModel / downloadModel", () => {
    test("startModel should call the correct RPC method and update agent manager", async () => {
      const params = {
        agentId: "agent-1",
        model: "model1",
      };

      await agentRPCService.startModel(params);

      expect(mockRpc.remote).toHaveBeenCalledWith("agent-1");
      const agentRpc = mockRpc.remote.mock.results[0].value;
      expect(agentRpc.startModel).toHaveBeenCalledWith({ model: "model1" });
      expect(agentManager.addLoadedModel).toHaveBeenCalledWith(
        "agent-1",
        "model1"
      );
    });

    test("downloadModel should call the correct RPC method", async () => {
      const params = {
        agentId: "agent-1",
        url: "http://example.com/model.gguf",
        filename: "model.gguf",
      };

      await agentRPCService.downloadModel(params);

      expect(mockRpc.remote).toHaveBeenCalledWith("agent-1");
      const agentRpc = mockRpc.remote.mock.results[0].value;
      expect(agentRpc.downloadModel).toHaveBeenCalledWith({
        url: "http://example.com/model.gguf",
        filename: "model.gguf",
      });
    });
  });

  describe("Other methods", () => {
    test("listModels should update installed models", async () => {
      await agentRPCService.listModels({ agentId: "agent-1" });
      expect(agentManager.setInstalledModels).toHaveBeenCalledWith("agent-1", [
        "model1",
      ]);
    });

    test("handleAgentError should log error", () => {
      const params = {
        agentId: "agent-1",
        error: "Something went wrong",
        context: { foo: "bar" },
      };

      agentRPCService.handleAgentError(params);

      expect(logger.error).toHaveBeenCalled();
    });
  });
});
