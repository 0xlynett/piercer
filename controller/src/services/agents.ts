import type { Db } from "./db";
import type { Logger } from "./logger";

export interface Agent {
  id: string;
  name: string;
  loadedModels: string[];
  installedModels: string[];
  pendingRequests: number;
}

interface CompletionBuffer {
  chunks: any[];
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private requestToAgent: Map<string, string> = new Map();
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
    this.agents.set(id, {
      id,
      name,
      loadedModels: [],
      installedModels: [],
      pendingRequests: 0,
    });
    this.db.registerAgent(id, name);
    this.logger.info(`Agent added to agent manager: ${name} (${id})`);
  }

  removeAgent(id: string): void {
    const agent = this.agents.get(id);
    if (agent) {
      this.agents.delete(id);
      for (const [requestId, agentId] of this.requestToAgent.entries()) {
        if (agentId === id) {
          this.requestToAgent.delete(requestId);
        }
      }
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
    const agent = this.agents.get(agentId);
    return agent?.loadedModels || [];
  }

  addLoadedModel(agentId: string, modelName: string): void {
    const agent = this.agents.get(agentId);
    if (agent && !agent.loadedModels.includes(modelName)) {
      agent.loadedModels.push(modelName);
    }
  }

  removeLoadedModel(agentId: string, modelName: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      const index = agent.loadedModels.indexOf(modelName);
      if (index !== -1) {
        agent.loadedModels.splice(index, 1);
      }
    }
  }

  getInstalledModels(agentId: string): string[] {
    const agent = this.agents.get(agentId);
    return agent?.installedModels || [];
  }

  setInstalledModels(agentId: string, modelNames: string[]): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.installedModels = modelNames;
    }
  }

  getPendingRequests(agentId: string): number {
    const agent = this.agents.get(agentId);
    return agent?.pendingRequests || 0;
  }

  incrementPendingRequests(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.pendingRequests++;
    }
  }

  decrementPendingRequests(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.pendingRequests = Math.max(0, agent.pendingRequests - 1);
    }
  }

  bindRequestToAgent(requestId: string, agentId: string): void {
    this.requestToAgent.set(requestId, agentId);
  }

  getAgentForRequest(requestId: string): string | undefined {
    return this.requestToAgent.get(requestId);
  }

  unbindRequestFromAgent(requestId: string): string | undefined {
    const agentId = this.requestToAgent.get(requestId);
    this.requestToAgent.delete(requestId);
    return agentId;
  }
}
