import type { Db } from "./db";
import type { Logger } from "./logger";

export interface Agent {
  id: string;
  name: string;
}

interface CompletionBuffer {
  chunks: any[];
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private loadedModels: Map<string, string[]> = new Map();
  private installedModels: Map<string, string[]> = new Map();
  private pendingRequests: Map<string, number> = new Map();
  private activeStreams: Map<string, ReadableStreamDefaultController> =
    new Map();
  private completionBuffers: Map<string, CompletionBuffer> = new Map();

  constructor(private db: Db, private logger: Logger) {}

  // Stream Management
  registerStream(
    requestId: string,
    controller: ReadableStreamDefaultController
  ): void {
    this.activeStreams.set(requestId, controller);
  }

  getStream(requestId: string): ReadableStreamDefaultController | undefined {
    return this.activeStreams.get(requestId);
  }

  removeStream(requestId: string): void {
    this.activeStreams.delete(requestId);
  }

  // Completion Buffer Management (for non-streaming requests)
  registerCompletionBuffer(requestId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.completionBuffers.set(requestId, {
        chunks: [],
        resolve,
        reject,
      });
    });
  }

  getCompletionBuffer(requestId: string): CompletionBuffer | undefined {
    return this.completionBuffers.get(requestId);
  }

  addChunkToBuffer(requestId: string, chunk: any): void {
    const buffer = this.completionBuffers.get(requestId);
    if (buffer) {
      buffer.chunks.push(chunk);
    }
  }

  resolveCompletionBuffer(requestId: string, result: any): void {
    const buffer = this.completionBuffers.get(requestId);
    if (buffer) {
      buffer.resolve(result);
      this.completionBuffers.delete(requestId);
    }
  }

  rejectCompletionBuffer(requestId: string, error: any): void {
    const buffer = this.completionBuffers.get(requestId);
    if (buffer) {
      buffer.reject(error);
      this.completionBuffers.delete(requestId);
    }
  }

  addAgent(id: string, name: string): void {
    this.agents.set(id, { id, name });
    this.pendingRequests.set(id, 0);
    this.db.registerAgent(id, name);
    this.logger.info(`Agent connected: ${name} (${id})`);
  }

  removeAgent(id: string): void {
    const agent = this.agents.get(id);
    if (agent) {
      this.agents.delete(id);
      this.loadedModels.delete(id);
      this.installedModels.delete(id);
      this.pendingRequests.delete(id);
      this.db.updateAgentStatus(id, "disconnected");
      this.logger.info(`Agent disconnected: ${agent.name} (${id})`);
    }
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getLoadedModels(agentId: string): string[] {
    return this.loadedModels.get(agentId) || [];
  }

  addLoadedModel(agentId: string, modelName: string): void {
    const models = this.loadedModels.get(agentId) || [];
    if (!models.includes(modelName)) {
      models.push(modelName);
      this.loadedModels.set(agentId, models);
    }
  }

  removeLoadedModel(agentId: string, modelName: string): void {
    const models = this.loadedModels.get(agentId) || [];
    const index = models.indexOf(modelName);
    if (index !== -1) {
      models.splice(index, 1);
      this.loadedModels.set(agentId, models);
    }
  }

  getInstalledModels(agentId: string): string[] {
    return this.installedModels.get(agentId) || [];
  }

  setInstalledModels(agentId: string, modelNames: string[]): void {
    this.installedModels.set(agentId, modelNames);
  }

  getPendingRequests(agentId: string): number {
    return this.pendingRequests.get(agentId) || 0;
  }

  incrementPendingRequests(agentId: string): void {
    const count = this.pendingRequests.get(agentId) || 0;
    this.pendingRequests.set(agentId, count + 1);
  }

  decrementPendingRequests(agentId: string): void {
    const count = this.pendingRequests.get(agentId) || 0;
    this.pendingRequests.set(agentId, Math.max(0, count - 1));
  }
}
