import { test, expect, beforeEach, afterEach } from "bun:test";
import { BunDatabase } from "../src/services/db";
import type { Db } from "../src/services/db";
import { randomUUID } from "crypto";

test("BunDatabase - Agent operations", () => {
  let db: Db;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = `./test-${randomUUID()}.db`;
    db = new BunDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    // Clean up test database file
    try {
      Bun.file(testDbPath)?.delete();
    } catch {
      // Ignore cleanup errors
    }
  });

  test("should register and retrieve agent", () => {
    const agentId = "test-agent-1";
    const agentName = "Test Agent";
    const capabilities = ["completion", "chat"];

    db.registerAgent(agentId, agentName, capabilities);

    const agent = db.getAgent(agentId);
    expect(agent).toBeDefined();
    expect(agent!.id).toBe(agentId);
    expect(agent!.name).toBe(agentName);
    expect(agent!.status).toBe("connected");
    expect(agent!.capabilities).toEqual(capabilities);
    expect(agent!.pending_requests).toBe(0);
  });

  test("should update agent status", () => {
    const agentId = "test-agent-2";
    const agentName = "Test Agent 2";

    db.registerAgent(agentId, agentName);
    db.updateAgentStatus(agentId, "busy", 5);

    const agent = db.getAgent(agentId);
    expect(agent!.status).toBe("busy");
    expect(agent!.pending_requests).toBe(5);
  });

  test("should get all agents", () => {
    db.registerAgent("agent-1", "Agent 1");
    db.registerAgent("agent-2", "Agent 2");

    const agents = db.getAllAgents();
    expect(agents).toHaveLength(2);
    expect(agents[0]!.id).toBe("agent-1");
    expect(agents[1]!.id).toBe("agent-2");
  });

  test("should get connected agents", () => {
    db.registerAgent("agent-1", "Agent 1");
    db.registerAgent("agent-2", "Agent 2");
    db.updateAgentStatus("agent-1", "disconnected");

    const connectedAgents = db.getConnectedAgents();
    expect(connectedAgents).toHaveLength(1);
    expect(connectedAgents[0]!.id).toBe("agent-2");
  });
});

test("BunDatabase - Model mapping operations", () => {
  let db: Db;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = `./test-${randomUUID()}.db`;
    db = new BunDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    try {
      Bun.file(testDbPath)?.delete();
    } catch {
      // Ignore cleanup errors
    }
  });

  test("should add and retrieve model mapping", () => {
    const internalName = "llama-7b-q8.gguf";
    const publicName = "llama-7b";

    const mappingId = db.addModelMapping(internalName, publicName);
    expect(mappingId).toBeDefined();

    const mapping = db.getModelMapping(publicName);
    expect(mapping).toBeDefined();
    expect(mapping!.internal_name).toBe(internalName);
    expect(mapping!.public_name).toBe(publicName);
  });

  test("should get all model mappings", () => {
    db.addModelMapping("model1.gguf", "model1");
    db.addModelMapping("model2.gguf", "model2");

    const mappings = db.getAllModelMappings();
    expect(mappings).toHaveLength(2);
    expect(mappings[0]!.public_name).toBe("model1");
    expect(mappings[1]!.public_name).toBe("model2");
  });
});

test("BunDatabase - Pending request operations", () => {
  let db: Db;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = `./test-${randomUUID()}.db`;
    db = new BunDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    try {
      Bun.file(testDbPath)?.delete();
    } catch {
      // Ignore cleanup errors
    }
  });

  test("should add and track pending requests", () => {
    const agentId = "test-agent";
    db.registerAgent(agentId, "Test Agent");

    const requestId = db.addPendingRequest(agentId, "completion", "llama-7b");
    expect(requestId).toBeDefined();

    const request = db.getPendingRequest(requestId);
    expect(request).toBeDefined();
    expect(request!.agent_id).toBe(agentId);
    expect(request!.request_type).toBe("completion");
    expect(request!.model).toBe("llama-7b");
    expect(request!.status).toBe("pending");

    // Check that agent's pending count was incremented
    const agent = db.getAgent(agentId);
    expect(agent!.pending_requests).toBe(1);
  });

  test("should update request status and decrement agent count", () => {
    const agentId = "test-agent";
    db.registerAgent(agentId, "Test Agent");

    const requestId = db.addPendingRequest(agentId, "chat", "llama-7b");
    db.updatePendingRequestStatus(requestId, "completed");

    const request = db.getPendingRequest(requestId);
    expect(request!.status).toBe("completed");
    expect(request!.completed_at).toBeDefined();

    const agent = db.getAgent(agentId);
    expect(agent!.pending_requests).toBe(0);
  });

  test("should get pending requests by agent", () => {
    const agentId = "test-agent";
    db.registerAgent(agentId, "Test Agent");

    const requestId1 = db.addPendingRequest(agentId, "completion", "model1");
    const requestId2 = db.addPendingRequest(agentId, "chat", "model2");

    const requests = db.getPendingRequestsByAgent(agentId);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.id).toBe(requestId1);
    expect(requests[1]!.id).toBe(requestId2);
  });
});

test("BunDatabase - Cleanup operations", () => {
  let db: Db;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = `./test-${randomUUID()}.db`;
    db = new BunDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    try {
      Bun.file(testDbPath)?.delete();
    } catch {
      // Ignore cleanup errors
    }
  });

  test("should cleanup old records", () => {
    const agentId = "test-agent";
    db.registerAgent(agentId, "Test Agent");

    const oldRequestId = db.addPendingRequest(agentId, "completion", "model1");
    db.updatePendingRequestStatus(oldRequestId, "completed");

    // Manually set created_at to old timestamp
    // Note: This is a bit hacky but tests the cleanup logic
    const cutoff = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    (db as any).db.exec(
      `UPDATE pending_requests SET created_at = ? WHERE id = ?`,
      [cutoff, oldRequestId]
    );

    db.cleanupOldRecords(24 * 60 * 60 * 1000); // 24 hours

    const request = db.getPendingRequest(oldRequestId);
    expect(request).toBeNull();
  });
});
