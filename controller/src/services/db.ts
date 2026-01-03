import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";

export interface Agent {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "busy" | "idle";
  capabilities: string[];
  last_seen: number;
  pending_requests: number;
  created_at: number;
}

export interface ModelMapping {
  id: string;
  internal_name: string;
  public_name: string;
  created_at: number;
}

export interface PendingRequest {
  id: string;
  agent_id: string;
  request_type: "completion" | "chat";
  model: string;
  status: "pending" | "processing" | "completed" | "failed";
  created_at: number;
  completed_at?: number;
}

export class DatabaseService {
  private db: Database;

  constructor(dbPath: string = "./piercer.db") {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Create agents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'disconnected',
        capabilities TEXT NOT NULL DEFAULT '[]',
        last_seen INTEGER NOT NULL DEFAULT 0,
        pending_requests INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);

    // Create model_mappings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_mappings (
        id TEXT PRIMARY KEY,
        internal_name TEXT NOT NULL UNIQUE,
        public_name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      )
    `);

    // Create pending_requests table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_requests (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        request_type TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
      CREATE INDEX IF NOT EXISTS idx_agents_pending_requests ON agents(pending_requests);
      CREATE INDEX IF NOT EXISTS idx_pending_requests_status ON pending_requests(status);
      CREATE INDEX IF NOT EXISTS idx_pending_requests_agent_id ON pending_requests(agent_id);
    `);
  }

  // Agent operations
  registerAgent(id: string, name: string, capabilities: string[] = []): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agents (id, name, status, capabilities, last_seen, pending_requests, created_at)
      VALUES (?, ?, 'connected', ?, ?, 0, ?)
    `);

    stmt.run(id, name, JSON.stringify(capabilities), Date.now(), Date.now());
  }

  updateAgentStatus(
    id: string,
    status: Agent["status"],
    pendingRequests: number = 0
  ): void {
    const stmt = this.db.prepare(`
      UPDATE agents 
      SET status = ?, pending_requests = ?, last_seen = ?
      WHERE id = ?
    `);

    stmt.run(status, pendingRequests, Date.now(), id);
  }

  getAgent(id: string): Agent | null {
    const stmt = this.db.prepare(`SELECT * FROM agents WHERE id = ?`);
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      status: row.status,
      capabilities: JSON.parse(row.capabilities),
      last_seen: row.last_seen,
      pending_requests: row.pending_requests,
      created_at: row.created_at,
    };
  }

  getAllAgents(): Agent[] {
    const stmt = this.db.prepare(`SELECT * FROM agents ORDER BY id`);
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      capabilities: JSON.parse(row.capabilities),
      last_seen: row.last_seen,
      pending_requests: row.pending_requests,
      created_at: row.created_at,
    }));
  }

  getConnectedAgents(): Agent[] {
    const stmt = this.db.prepare(
      `SELECT * FROM agents WHERE status = 'connected' ORDER BY pending_requests, id`
    );
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      capabilities: JSON.parse(row.capabilities),
      last_seen: row.last_seen,
      pending_requests: row.pending_requests,
      created_at: row.created_at,
    }));
  }

  // Model mapping operations
  addModelMapping(internalName: string, publicName: string): string {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO model_mappings (id, internal_name, public_name, created_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(id, internalName, publicName, Date.now());
    return id;
  }

  getModelMapping(publicName: string): ModelMapping | null {
    const stmt = this.db.prepare(
      `SELECT * FROM model_mappings WHERE public_name = ?`
    );
    const row = stmt.get(publicName) as any;

    if (!row) return null;

    return {
      id: row.id,
      internal_name: row.internal_name,
      public_name: row.public_name,
      created_at: row.created_at,
    };
  }

  getAllModelMappings(): ModelMapping[] {
    const stmt = this.db.prepare(
      `SELECT * FROM model_mappings ORDER BY public_name`
    );
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      internal_name: row.internal_name,
      public_name: row.public_name,
      created_at: row.created_at,
    }));
  }

  // Pending request operations
  addPendingRequest(
    agentId: string,
    requestType: "completion" | "chat",
    model: string
  ): string {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO pending_requests (id, agent_id, request_type, model, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);

    stmt.run(id, agentId, requestType, model, Date.now());

    // Update agent's pending request count
    this.incrementAgentPendingRequests(agentId);

    return id;
  }

  updatePendingRequestStatus(
    id: string,
    status: PendingRequest["status"]
  ): void {
    const stmt = this.db.prepare(`
      UPDATE pending_requests 
      SET status = ?, completed_at = ?
      WHERE id = ?
    `);

    const completedAt =
      status === "completed" || status === "failed" ? Date.now() : null;
    stmt.run(status, completedAt, id);

    // If request is completed/failed, decrement agent's pending count
    if (status === "completed" || status === "failed") {
      const request = this.getPendingRequest(id);
      if (request) {
        this.decrementAgentPendingRequests(request.agent_id);
      }
    }
  }

  getPendingRequest(id: string): PendingRequest | null {
    const stmt = this.db.prepare(`SELECT * FROM pending_requests WHERE id = ?`);
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      agent_id: row.agent_id,
      request_type: row.request_type,
      model: row.model,
      status: row.status,
      created_at: row.created_at,
      completed_at: row.completed_at,
    };
  }

  getPendingRequestsByAgent(agentId: string): PendingRequest[] {
    const stmt = this.db.prepare(
      `SELECT * FROM pending_requests WHERE agent_id = ? ORDER BY created_at`
    );
    const rows = stmt.all(agentId) as any[];

    return rows.map((row) => ({
      id: row.id,
      agent_id: row.agent_id,
      request_type: row.request_type,
      model: row.model,
      status: row.status,
      created_at: row.created_at,
      completed_at: row.completed_at,
    }));
  }

  private incrementAgentPendingRequests(agentId: string): void {
    const stmt = this.db.prepare(`
      UPDATE agents 
      SET pending_requests = pending_requests + 1
      WHERE id = ?
    `);

    stmt.run(agentId);
  }

  private decrementAgentPendingRequests(agentId: string): void {
    const stmt = this.db.prepare(`
      UPDATE agents 
      SET pending_requests = MAX(0, pending_requests - 1)
      WHERE id = ?
    `);

    stmt.run(agentId);
  }

  // Cleanup old records
  cleanupOldRecords(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;

    // Clean up old pending requests
    this.db.exec(
      `DELETE FROM pending_requests WHERE created_at < ? AND status IN ('completed', 'failed')`,
      [cutoff]
    );

    // Mark disconnected agents as offline if they haven't been seen for a while
    this.db.exec(
      `UPDATE agents SET status = 'disconnected' WHERE last_seen < ? AND status = 'connected'`,
      [cutoff]
    );
  }

  close(): void {
    this.db.close();
  }
}
