import { DatabaseService } from "../services/db.js";
import { logger, createAgentLogger } from "../services/logger.js";

export interface AgentInfo {
  id: string;
  name: string;
  capabilities: string[];
  connectedAt: number;
}

export class WebSocketHandler {
  private db: DatabaseService;
  private connectedAgents: Map<string, AgentInfo> = new Map();

  constructor(db: DatabaseService) {
    this.db = db;
  }

  public getAgentAPI() {
    return {
      // Controller calls these on agent
      completion: (params: any) => this.handleCompletion(params),
      chat: (params: any) => this.handleChat(params),
      listModels: () => this.handleListModels(),
      currentModels: () => this.handleCurrentModels(),
      startModel: (params: any) => this.handleStartModel(params),
      downloadModel: (params: any) => this.handleDownloadModel(params),
      status: () => this.handleStatus(),

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

    if (!agentId || !agentName) {
      logger.warn("Agent connection rejected: missing headers", {
        hasAgentId: !!agentId,
        hasAgentName: !!agentName,
      });
      ws.close(1008, "Missing agent identification headers");
      return;
    }

    // Check for duplicate agent ID
    if (this.connectedAgents.has(agentId)) {
      logger.warn("Agent connection rejected: duplicate agent ID", {
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

    // Register in database
    this.db.registerAgent(agentId, agentName, []);

    // Log connection
    const agentLogger = createAgentLogger(agentId);
    agentLogger.agentConnected(agentId, agentName, []);

    logger.info("Agent connected", {
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

    const agentLogger = createAgentLogger(agentId);
    agentLogger.agentDisconnected(agentId, reason || `Code: ${code}`);

    logger.info("Agent disconnected", {
      agentId,
      code,
      reason,
      remainingAgents: this.connectedAgents.size,
    });
  }

  private handleError(ws: any, error: Error): void {
    const agentId = ws.agentId;
    if (agentId) {
      const agentLogger = createAgentLogger(agentId);
      agentLogger.agentError(agentId, error);
    } else {
      logger.error("WebSocket error from unknown connection", error);
    }
  }

  // Controller -> Agent procedures
  private async handleCompletion(params: any): Promise<any> {
    logger.info("Completion request", params);
    // TODO: Implement completion logic
    return { result: "completion_result" };
  }

  private async handleChat(params: any): Promise<any> {
    logger.info("Chat request", params);
    // TODO: Implement chat logic
    return { result: "chat_result" };
  }

  private async handleListModels(): Promise<any> {
    logger.info("List models request");
    // TODO: Implement list models logic
    return { models: [] };
  }

  private async handleCurrentModels(): Promise<any> {
    logger.info("Current models request");
    // TODO: Implement current models logic
    return { models: [] };
  }

  private async handleStartModel(params: any): Promise<any> {
    logger.info("Start model request", params);
    // TODO: Implement start model logic
    return { models: [] };
  }

  private async handleDownloadModel(params: any): Promise<any> {
    logger.info("Download model request", params);
    // TODO: Implement download model logic
    return { filename: "downloaded_model.gguf" };
  }

  private async handleStatus(): Promise<any> {
    logger.info("Status request");
    // TODO: Implement status logic
    return { status: "ready" };
  }

  // Agent -> Controller procedures
  private handleAgentError(params: any): void {
    logger.error("Agent error", new Error(params.error), {
      agentId: params.agentId,
      context: params.context,
    });
  }

  private handleReceiveCompletion(params: any): void {
    logger.debug("Received completion stream", {
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
    logger.info("Shutting down WebSocket handler", {
      connectedAgents: this.connectedAgents.size,
    });
    this.connectedAgents.clear();
  }
}
