import type { Db } from "../services/db";
import type { Logger } from "../services/logger";
import type { AgentManager } from "../services/agents";
import type { RPC } from "@piercer/rpc";
import type { BunTransport } from "../utils/bun-transport";
import type { WSContext } from "hono/ws";
import type { AgentFunctions, ControllerFunctions } from "../rpc-types";

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

  // Controller -> Agent methods
  completion(params: any): Promise<any>;
  chat(params: any): Promise<any>;
  listModels(params: { agentId: string }): Promise<any>;
  currentModels(params: { agentId: string }): Promise<any>;
  startModel(params: any): Promise<any>;
  downloadModel(params: any): Promise<any>;
  status(params: { agentId: string }): Promise<any>;
}

// WebSocket Handler Implementation
export class PiercerWebSocketHandler implements WebSocketHandler {
  private db: Db;
  private logger: Logger;
  private agentManager: AgentManager;
  private connectedAgents: Map<string, AgentInfo> = new Map();
  private rpc: RPC<ControllerFunctions> | null = null;
  private transport: BunTransport;

  constructor(
    db: Db,
    logger: Logger,
    agentManager: AgentManager,
    transport: BunTransport
  ) {
    this.db = db;
    this.logger = logger;
    this.agentManager = agentManager;
    this.transport = transport;
  }

  public setRpc(rpc: RPC<ControllerFunctions>) {
    this.rpc = rpc;
  }

  public getAgentAPI(): ControllerFunctions {
    return {
      // Agent calls these on controller
      error: (params: any) => this.handleAgentError(params),
      receiveCompletion: (params: any) => this.handleReceiveCompletion(params),
    };
  }

  public handleConnection(ws: WSContext, req: Request): void {
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

    // Check for duplicate agent ID
    if (this.connectedAgents.has(agentId)) {
      this.logger.warn("Agent connection rejected: duplicate agent ID", {
        agentId,
        agentName,
      });
      ws.close(1008, "Agent ID already connected");
      return;
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

    this.logger.info("Agent connected", {
      agentId,
      agentName,
      totalAgents: this.connectedAgents.size,
    });
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

  // Controller -> Agent procedures
  public async completion(params: any): Promise<any> {
    this.logger.info("Completion request", params);
    const { agentId, ...completionParams } = params;
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.remote<AgentFunctions>(agentId);
    return agentRpc.completion(completionParams);
  }

  public async chat(params: any): Promise<any> {
    this.logger.info("Chat request", params);
    const { agentId, ...chatParams } = params;
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.remote<AgentFunctions>(agentId);
    return agentRpc.chat(chatParams);
  }

  public async listModels({ agentId }: { agentId: string }): Promise<any> {
    this.logger.info("List models request", { agentId });
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.remote<AgentFunctions>(agentId);
    const { models } = await agentRpc.listModels();
    this.agentManager.setInstalledModels(agentId, models);
    return { models };
  }

  public async currentModels({ agentId }: { agentId: string }): Promise<any> {
    this.logger.info("Current models request", { agentId });
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.remote<AgentFunctions>(agentId);
    return agentRpc.currentModels();
  }

  public async startModel(params: any): Promise<any> {
    this.logger.info("Start model request", params);
    const { agentId, model } = params;
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.remote<AgentFunctions>(agentId);
    const result = await agentRpc.startModel({ model });
    result.models.forEach((m: string) => {
      this.agentManager.addLoadedModel(agentId, m);
    });
    return result;
  }

  public async downloadModel(params: any): Promise<any> {
    this.logger.info("Download model request", params);
    const { agentId, ...downloadParams } = params;
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.remote<AgentFunctions>(agentId);
    return agentRpc.downloadModel(downloadParams);
  }

  public async status({ agentId }: { agentId: string }): Promise<any> {
    this.logger.info("Status request", { agentId });
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.remote<AgentFunctions>(agentId);
    return agentRpc.status();
  }

  // Agent -> Controller procedures
  private handleAgentError(params: any): void {
    this.logger.error("Agent error", new Error(params.error), {
      agentId: params.agentId,
      context: params.context,
    });
  }

  private handleReceiveCompletion(params: any): void {
    this.logger.debug("Received completion stream", {
      agentId: params.agentId,
      requestId: params.requestId,
      hasData: !!params.data,
    });
    // TODO: Forward completion stream to requester
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
