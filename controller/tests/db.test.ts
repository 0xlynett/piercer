import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { BunDatabase } from "../src/services/db";
import type { Db } from "../src/services/db";
import { randomUUID } from "crypto";

describe("BunDatabase - Agent registry operations", () => {
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

    db.registerAgent(agentId, agentName);

    const agent = db.getAgent(agentId);
    expect(agent).toBeDefined();
    expect(agent!.id).toBe(agentId);
    expect(agent!.name).toBe(agentName);
    expect(agent!.first_seen).toBeDefined();
    expect(agent!.last_seen).toBeDefined();
  });

  test("should update agent last_seen", () => {
    const agentId = "test-agent-2";
    const agentName = "Test Agent 2";

    db.registerAgent(agentId, agentName);
    const firstLastSeen = db.getAgent(agentId)!.last_seen;

    // Wait a bit to ensure timestamp changes
    const now = Date.now();
    while (Date.now() === now) {
      // busy wait
    }

    db.updateAgentLastSeen(agentId);

    const agent = db.getAgent(agentId);
    expect(agent!.last_seen).toBeGreaterThan(firstLastSeen);
  });

  test("should get all agents", () => {
    db.registerAgent("agent-1", "Agent 1");
    db.registerAgent("agent-2", "Agent 2");

    const agents = db.getAllAgents();
    expect(agents).toHaveLength(2);
    expect(agents[0]!.id).toBe("agent-1");
    expect(agents[1]!.id).toBe("agent-2");
  });
});

describe("BunDatabase - Model mapping operations", () => {
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

  test("should remove model mapping", () => {
    db.addModelMapping("model1.gguf", "model1");

    const removed = db.removeModelMapping("model1");
    expect(removed).toBe(true);

    const mapping = db.getModelMapping("model1");
    expect(mapping).toBeNull();
  });

  test("should return false when removing non-existent mapping", () => {
    const removed = db.removeModelMapping("non-existent");
    expect(removed).toBe(false);
  });
});

describe("BunDatabase - Cleanup operations", () => {
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

  test("should cleanup old agent records", () => {
    const agentId = "test-agent";
    db.registerAgent(agentId, "Test Agent");

    // Manually set last_seen to old timestamp
    const cutoff = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    (db as any).db.exec(`UPDATE agents SET last_seen = ? WHERE id = ?`, [
      cutoff,
      agentId,
    ]);

    db.cleanupOldRecords(24 * 60 * 60 * 1000); // 24 hours

    const agent = db.getAgent(agentId);
    expect(agent).toBeNull();
  });
});
