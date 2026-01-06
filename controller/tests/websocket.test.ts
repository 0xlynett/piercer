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
  let mockWsContext: any;

  beforeEach(() => {
    testDbPath = `./test-${randomUUID()}.db`;
    db = new BunDatabase(testDbPath);
    logger = new PinoLogger({ level: "info" });
    agentManager = new AgentManager(db, logger);
    agentRPCService = new AgentRPCService(agentManager, logger);
    transport = new BunTransport();

    // Mock WSContext
    mockWsContext = {
      close: mock(),
      raw: {}, // Mock raw websocket if needed by transport
    };

    // Mock Transport registerClient/removeClient to avoid actual WS operations if possible
    // But BunTransport uses ws.raw which might be tricky.
    // Let's see if we can mock transport methods instead.
    transport.registerClient = mock();
    transport.removeClient = mock();
    transport.getClientId = mock();

    wsHandler = new PiercerWebSocketHandler(
      db,
      logger,
      agentManager,
      transport,
      agentRPCService
    );
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

  describe("Authentication", () => {
    test("should reject connection without agent-id", () => {
      const req = new Request("http://localhost/ws", {
        headers: {
          "agent-name": "test-agent",
        },
      });

      wsHandler.handleConnection(mockWsContext, req);

      expect(mockWsContext.close).toHaveBeenCalledWith(
        1008,
        "Missing agent identification headers"
      );
      expect(transport.registerClient).not.toHaveBeenCalled();
    });

    test("should reject connection with invalid Authorization token", () => {
      // Re-init with secret key
      wsHandler = new PiercerWebSocketHandler(
        db,
        logger,
        agentManager,
        transport,
        agentRPCService,
        "secret-key"
      );

      const req = new Request("http://localhost/ws", {
        headers: {
          "agent-id": "agent-1",
          "agent-name": "test-agent",
          Authorization: "Bearer wrong-key",
        },
      });

      wsHandler.handleConnection(mockWsContext, req);

      expect(mockWsContext.close).toHaveBeenCalledWith(
        1008,
        "Invalid authentication"
      );
      expect(transport.registerClient).not.toHaveBeenCalled();
    });

    test("should accept connection with valid Authorization token", () => {
      wsHandler = new PiercerWebSocketHandler(
        db,
        logger,
        agentManager,
        transport,
        agentRPCService,
        "secret-key"
      );

      const req = new Request("http://localhost/ws", {
        headers: {
          "agent-id": "agent-1",
          "agent-name": "test-agent",
          Authorization: "Bearer secret-key",
        },
      });

      wsHandler.handleConnection(mockWsContext, req);

      expect(mockWsContext.close).not.toHaveBeenCalled();
      expect(transport.registerClient).toHaveBeenCalled();
      expect(wsHandler.isAgentConnected("agent-1")).toBe(true);
    });
  });

  describe("Connection Management", () => {
    test("should accept valid connection", () => {
      const req = new Request("http://localhost/ws", {
        headers: {
          "agent-id": "agent-1",
          "agent-name": "test-agent",
          "agent-installed-models": "model1,model2",
        },
      });

      wsHandler.handleConnection(mockWsContext, req);

      expect(mockWsContext.close).not.toHaveBeenCalled();
      expect(transport.registerClient).toHaveBeenCalledWith(
        mockWsContext,
        "agent-1"
      );
      expect(wsHandler.isAgentConnected("agent-1")).toBe(true);

      const agent = wsHandler.getAgent("agent-1");
      expect(agent).toBeDefined();
      expect(agent?.name).toBe("test-agent");

      // Verify AgentManager was updated
      expect(agentManager.getAgent("agent-1")).toBeDefined();
      expect(agentManager.getInstalledModels("agent-1")).toEqual([
        "model1",
        "model2",
      ]);
    });

    test("should reject duplicate agent ID", () => {
      const req = new Request("http://localhost/ws", {
        headers: {
          "agent-id": "agent-1",
          "agent-name": "test-agent",
        },
      });

      // First connection
      wsHandler.handleConnection(mockWsContext, req);
      expect(wsHandler.isAgentConnected("agent-1")).toBe(true);

      // Second connection with same ID
      const mockWsContext2 = {
        close: mock(),
        raw: {},
      } as any;
      wsHandler.handleConnection(mockWsContext2, req);

      expect(mockWsContext2.close).toHaveBeenCalledWith(
        1008,
        "Agent ID already connected"
      );
    });

    test("should remove agent on disconnect", () => {
      // Setup connection
      const req = new Request("http://localhost/ws", {
        headers: {
          "agent-id": "agent-1",
          "agent-name": "test-agent",
        },
      });
      wsHandler.handleConnection(mockWsContext, req);
      expect(wsHandler.isAgentConnected("agent-1")).toBe(true);

      // Mock transport to return agentId
      (transport.getClientId as any).mockReturnValue("agent-1");

      // Disconnect
      wsHandler.handleDisconnection(mockWsContext, 1000, "Normal closure");

      expect(transport.removeClient).toHaveBeenCalledWith(mockWsContext);
      expect(wsHandler.isAgentConnected("agent-1")).toBe(false);
      expect(agentManager.getAgent("agent-1")).toBeUndefined();
    });
  });

  describe("API Exposure", () => {
    test("should expose correct agent API", () => {
      const api = wsHandler.getAgentAPI();
      expect(api).toBeDefined();
      expect(typeof api.error).toBe("function");
      expect(typeof api.receiveCompletion).toBe("function");
    });
  });
});
