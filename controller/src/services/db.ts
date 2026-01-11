import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";

// Data types - Agent registry only (status/capabilities are in-memory)
export interface AgentRegistry {
  id: string;
  name: string;
  first_seen: number;
  last_seen: number;
}

export interface ModelMapping {
  id: string;
  internal_name: string;
  public_name: string;
  created_at: number;
}

// Database Service Interface
export interface Db {
  // Agent registry operations (only stores id, name, timestamps)
  registerAgent(id: string, name: string): void;
  updateAgentLastSeen(id: string): void;
  getAgent(id: string): AgentRegistry | null;
  getAllAgents(): AgentRegistry[];

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
    // Create agents registry table (only stores id, name, timestamps)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
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
  }

  // Agent registry operations
  registerAgent(id: string, name: string): void {
    const now = Date.now();

    // Insert new agent or ignore if exists
    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO agents (id, name, first_seen, last_seen)
      VALUES (?, ?, ?, ?)
    `);
    insertStmt.run(id, name, now, now);

    // Update last_seen if agent already exists
    const updateStmt = this.db.prepare(`
      UPDATE agents SET last_seen = ? WHERE id = ?
    `);
    updateStmt.run(now, id);
  }

  updateAgentLastSeen(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE agents SET last_seen = ? WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }

  getAgent(id: string): AgentRegistry | null {
    const stmt = this.db.prepare(`SELECT * FROM agents WHERE id = ?`);
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
    };
  }

  getAllAgents(): AgentRegistry[] {
    const stmt = this.db.prepare(`SELECT * FROM agents ORDER BY id`);
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
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

    // Remove agents not seen for a while
    this.db.exec(`DELETE FROM agents WHERE last_seen < ?`, [cutoff]);
  }

  close(): void {
    this.db.close();
  }
}
