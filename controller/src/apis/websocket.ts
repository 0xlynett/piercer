import type { Db } from "../services/db";
import type { Logger } from "../services/logger";
import type { AgentManager } from "../services/agents";

export interface AgentInfo {
  id: string;
  name: string;
  capabilities: string[];
  connectedAt: number;
}

// WebSocket Handler Interface
export interface WebSocketHandler {
  getAgentAPI(): any;
  getConnectedAgents(): AgentInfo[];
  isAgentConnected(agentId: string): boolean;
  getAgent(agentId: string): AgentInfo | undefined;
  shutdown(): void;
}

// WebSocket Handler Implementation
export class KkrpcWebSocketHandler implements WebSocketHandler {
  private db: Db;
  private logger: Logger;
  private agentManager: AgentManager;
  private connectedAgents: Map<string, AgentInfo> = new Map();
  private rpc: any;

  constructor(db: Db, logger: Logger, agentManager: AgentManager) {
    this.db = db;
    this.logger = logger;
    this.agentManager = agentManager;
  }

  public setRpc(rpc: any) {
    this.rpc = rpc;
  }

  public getAgentAPI() {
    return {
      // Controller calls these on agent
      completion: (params: any) => this.handleCompletion(params),
      chat: (params: any) => this.handleChat(params),
      listModels: (params: any) => this.handleListModels(params),
      currentModels: (params: any) => this.handleCurrentModels(params),
      startModel: (params: any) => this.handleStartModel(params),
      downloadModel: (params: any) => this.handleDownloadModel(params),
      status: (params: any) => this.handleStatus(params),

      // Agent calls these on controller
      error: (params: any) => this.handleAgentError(params),
      receiveCompletion: (params: any) => this.handleReceiveCompletion(params),
    };
  }

  public getConnectionHandlers() {
    return {
      open: (ws: any, req: Request) => {
        this.handleConnection(ws, req);
      },
      close: (ws: any, code: number, reason: string) => {
        this.handleDisconnection(ws, code, reason);
      },
      error: (ws: any, error: Error) => {
        this.handleError(ws, error);
      },
    };
  }

  private handleConnection(ws: any, req: Request): void {
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

    // Log connection
    this.logger.agentConnected(agentId, agentName, installedModels);

    this.logger.info("Agent connected", {
      agentId,
      agentName,
      totalAgents: this.connectedAgents.size,
    });
  }

  private handleDisconnection(ws: any, code: number, reason: string): void {
    const agentId = ws.agentId;
    if (!agentId) return;

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

  private handleError(ws: any, error: Error): void {
    const agentId = ws.agentId;
    if (agentId) {
      this.logger.agentError(agentId, error);
    } else {
      this.logger.error("WebSocket error from unknown connection", error);
    }
  }

  // Controller -> Agent procedures
  private async handleCompletion(params: any): Promise<any> {
    this.logger.info("Completion request", params);
    const { agentId, ...completionParams } = params;
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.to(agentId);
    return agentRpc.completion(completionParams);
  }

  private async handleChat(params: any): Promise<any> {
    this.logger.info("Chat request", params);
    const { agentId, ...chatParams } = params;
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.to(agentId);
    return agentRpc.chat(chatParams);
  }

  private async handleListModels({
    agentId,
  }: {
    agentId: string;
  }): Promise<any> {
    this.logger.info("List models request", { agentId });
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.to(agentId);
    const { models } = await agentRpc.listModels();
    this.agentManager.setInstalledModels(agentId, models);
    return { models };
  }

  private async handleCurrentModels({
    agentId,
  }: {
    agentId: string;
  }): Promise<any> {
    this.logger.info("Current models request", { agentId });
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.to(agentId);
    return agentRpc.currentModels();
  }

  private async handleStartModel(params: any): Promise<any> {
    this.logger.info("Start model request", params);
    const { agentId, model } = params;
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.to(agentId);
    const result = await agentRpc.startModel({ model });
    result.models.forEach((m: string) => {
      this.agentManager.addLoadedModel(agentId, m);
    });
    return result;
  }

  private async handleDownloadModel(params: any): Promise<any> {
    this.logger.info("Download model request", params);
    const { agentId, ...downloadParams } = params;
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.to(agentId);
    return agentRpc.downloadModel(downloadParams);
  }

  private async handleStatus({ agentId }: { agentId: string }): Promise<any> {
    this.logger.info("Status request", { agentId });
    if (!this.rpc) throw new Error("RPC not initialized");
    const agentRpc = this.rpc.to(agentId);
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
