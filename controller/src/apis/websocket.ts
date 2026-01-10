import type { Db } from "../services/db";
import type { Logger } from "../services/logger";
import type { AgentManager } from "../services/agents";
import type { BunTransport } from "../utils/bun-transport";
import type { WSContext } from "hono/ws";
import type { ControllerFunctions } from "../rpc-types";
import type { AgentRPCService } from "../services/agent-rpc";

export interface AgentInfo {
  id: string;
  name: string;
  capabilities: string[];
  connectedAt: number;
}

// WebSocket Handler Interface
export interface WebSocketHandler {
  getAgentAPI(): ControllerFunctions;
  getConnectedAgents(): AgentInfo[];
  isAgentConnected(agentId: string): boolean;
  getAgent(agentId: string): AgentInfo | undefined;
  shutdown(): void;
  handleConnection(ws: WSContext, req: Request): void;
  handleDisconnection(ws: WSContext, code: number, reason: string): void;
  handleError(ws: WSContext, error: Error): void;
}

// WebSocket Handler Implementation
export class PiercerWebSocketHandler implements WebSocketHandler {
  private db: Db;
  private logger: Logger;
  private agentManager: AgentManager;
  private connectedAgents: Map<string, AgentInfo> = new Map();
  private transport: BunTransport;
  private agentRPCService: AgentRPCService;
  private agentSecretKey?: string;

  constructor(
    db: Db,
    logger: Logger,
    agentManager: AgentManager,
    transport: BunTransport,
    agentRPCService: AgentRPCService,
    agentSecretKey?: string
  ) {
    this.db = db;
    this.logger = logger;
    this.agentManager = agentManager;
    this.transport = transport;
    this.agentRPCService = agentRPCService;
    this.agentSecretKey = agentSecretKey;
  }

  public getAgentAPI(): ControllerFunctions {
    return {
      // Agent calls these on controller
      error: (params: any) => this.agentRPCService.handleAgentError(params),
      receiveCompletion: (params: any) =>
        this.agentRPCService.handleReceiveCompletion(params),
    };
  }

  public handleConnection(ws: WSContext, req: Request): void {
    // Check authentication if configured
    if (this.agentSecretKey) {
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

      if (!token || token !== this.agentSecretKey) {
        this.logger.warn("Agent connection rejected: invalid authentication", {
          hasAuthHeader: !!authHeader,
        });
        ws.close(1008, "Invalid authentication");
        return;
      }
    }

    const agentId = req.headers.get("agent-id");
    const agentName = req.headers.get("agent-name");
    const installedModelsHeader = req.headers.get("agent-installed-models");
    const installedModels = installedModelsHeader
      ? installedModelsHeader.split(",")
      : [];

    if (!agentId || !agentName) {
      this.logger.warn("Agent connection rejected: missing headers", {
        hasAgentId: !!agentId,
        hasAgentName: !!agentName,
      });
      ws.close(1008, "Missing agent identification headers");
      return;
    }

    // Check for duplicate agent ID - kick out old one and accept new one
    if (this.connectedAgents.has(agentId)) {
      const oldWs = this.transport.getClient(agentId);
      if (oldWs) {
        this.logger.info("Kicking out old agent connection", {
          agentId,
          oldAgentName: this.connectedAgents.get(agentId)?.name,
          newAgentName: agentName,
        });
        oldWs.close(1001, "Replaced by new connection");
      }
    }

    // Store agent info
    const agentInfo: AgentInfo = {
      id: agentId,
      name: agentName,
      capabilities: [],
      connectedAt: Date.now(),
    };

    this.connectedAgents.set(agentId, agentInfo);

    // Register in agent manager
    this.agentManager.addAgent(agentId, agentName);
    this.agentManager.setInstalledModels(agentId, installedModels);

    // Register with Transport
    this.transport.registerClient(ws, agentId);

    // Log connection
    this.logger.agentConnected(agentId, agentName, installedModels);
  }

  public handleDisconnection(
    ws: WSContext,
    code: number,
    reason: string
  ): void {
    const agentId = this.transport.getClientId(ws);
    if (!agentId) return;

    this.transport.removeClient(ws);
    this.connectedAgents.delete(agentId);
    this.agentManager.removeAgent(agentId);
    this.db.updateAgentStatus(agentId, "disconnected");

    this.logger.agentDisconnected(agentId, reason || `Code: ${code}`);

    this.logger.info("Agent disconnected", {
      agentId,
      code,
      reason,
      remainingAgents: this.connectedAgents.size,
    });
  }

  public handleError(ws: WSContext, error: Error): void {
    const agentId = this.transport.getClientId(ws);
    if (agentId) {
      this.logger.agentError(agentId, error);
    } else {
      this.logger.error("WebSocket error from unknown connection", error);
    }
  }

  // Public methods
  public getConnectedAgents(): AgentInfo[] {
    return Array.from(this.connectedAgents.values());
  }

  public isAgentConnected(agentId: string): boolean {
    return this.connectedAgents.has(agentId);
  }

  public getAgent(agentId: string): AgentInfo | undefined {
    return this.connectedAgents.get(agentId);
  }

  public shutdown(): void {
    this.logger.info("Shutting down WebSocket handler", {
      connectedAgents: this.connectedAgents.size,
    });
    this.connectedAgents.clear();
  }
}
