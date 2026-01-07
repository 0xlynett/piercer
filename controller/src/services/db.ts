import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";

// Data types
export interface Agent {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "busy" | "idle";
  capabilities: string[];
  last_seen: number;
  created_at: number;
}

export interface ModelMapping {
  id: string;
  internal_name: string;
  public_name: string;
  created_at: number;
}

// Database Service Interface
export interface Db {
  // Agent operations
  registerAgent(id: string, name: string, capabilities?: string[]): void;
  updateAgentStatus(id: string, status: Agent["status"]): void;
  getAgent(id: string): Agent | null;
  getAllAgents(): Agent[];
  getConnectedAgents(): Agent[];

  // Model mapping operations
  addModelMapping(internalName: string, publicName: string): string;
  getModelMapping(publicName: string): ModelMapping | null;
  getAllModelMappings(): ModelMapping[];
  removeModelMapping(publicName: string): boolean;

  // Cleanup and maintenance
  cleanupOldRecords(maxAge?: number): void;
  close(): void;
}

// Bun Database Implementation
export class BunDatabase implements Db {
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

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    `);
  }

  // Agent operations
  registerAgent(id: string, name: string, capabilities: string[] = []): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO agents (id, name, status, capabilities, last_seen, created_at)
      VALUES (?, ?, 'connected', ?, ?, ?)
    `);

    stmt.run(id, name, JSON.stringify(capabilities), Date.now(), Date.now());

    // Update status and last_seen if agent already exists
    const updateStmt = this.db.prepare(`
      UPDATE agents
      SET status = 'connected', last_seen = ?
      WHERE id = ?
    `);
    updateStmt.run(Date.now(), id);
  }

  updateAgentStatus(id: string, status: Agent["status"]): void {
    const stmt = this.db.prepare(`
      UPDATE agents
      SET status = ?, last_seen = ?
      WHERE id = ?
    `);

    stmt.run(status, Date.now(), id);
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
      created_at: row.created_at,
    }));
  }

  getConnectedAgents(): Agent[] {
    const stmt = this.db.prepare(
      `SELECT * FROM agents WHERE status = 'connected' ORDER BY id`
    );
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      capabilities: JSON.parse(row.capabilities),
      last_seen: row.last_seen,
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

  removeModelMapping(publicName: string): boolean {
    const stmt = this.db.prepare(
      `DELETE FROM model_mappings WHERE public_name = ?`
    );
    const result = stmt.run(publicName);
    return result.changes > 0;
  }

  // Cleanup old records
  cleanupOldRecords(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;

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
