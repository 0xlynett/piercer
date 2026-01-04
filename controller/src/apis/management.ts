import type { Context } from "hono";
import type { Db } from "../services/db";
import type { Logger } from "../services/logger";
import type { AgentManager } from "../services/agents";
import type { MappingsService } from "../services/mappings";
import type { WebSocketHandler } from "./websocket";

export interface ManagementAPIConfig {
  db: Db;
  logger: Logger;
  agentManager: AgentManager;
  mappingsService: MappingsService;
  wsHandler: WebSocketHandler;
}

export class ManagementAPIHandler {
  private db: Db;
  private logger: Logger;
  private agentManager: AgentManager;
  private mappingsService: MappingsService;
  private wsHandler: WebSocketHandler;

  constructor(config: ManagementAPIConfig) {
    this.db = config.db;
    this.logger = config.logger;
    this.agentManager = config.agentManager;
    this.mappingsService = config.mappingsService;
    this.wsHandler = config.wsHandler;
  }

  async createModelMapping(c: Context) {
    const body = await c.req.json();
    const { public_name, filename } = body;

    if (!public_name || !filename) {
      return c.json({ error: "public_name and filename are required" }, 400);
    }

    this.mappingsService.addMapping(filename, public_name);
    this.logger.info(`Model mapping created: ${public_name} -> ${filename}`);
    return c.json({ success: true });
  }

  async listModelMappings(c: Context) {
    const mappings = this.mappingsService.getAllMappings();
    return c.json(mappings);
  }

  async deleteModelMapping(c: Context) {
    const publicName = c.req.param("publicName");
    const success = this.mappingsService.removeMapping(publicName);
    if (success) {
      this.logger.info(`Model mapping deleted: ${publicName}`);
      return c.json({ success: true });
    }
    return c.json({ error: "Mapping not found" }, 404);
  }

  async downloadModel(c: Context) {
    const agentId = c.req.param("agentId");
    const body = await c.req.json();
    const { model_url, filename } = body;

    this.logger.info(
      `Placeholder: Download request for agent ${agentId}, model ${model_url} as ${filename}`
    );

    // TODO: actually call the agent via websocket
    return c.json({ success: true, status: "download_started" });
  }

  async listAgents(c: Context) {
    const agents = this.agentManager.getAllAgents();
    // TODO: get more stats from agents.
    return c.json(agents);
  }
}
