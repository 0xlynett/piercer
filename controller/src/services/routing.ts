import type { Db } from "./db";
import type { Logger } from "./logger";
import type { Agent } from "./db";

export interface RoutingRequest {
  model: string;
  requestType: "completion" | "chat";
  requestId: string;
}

export interface RoutingResult {
  agent: Agent;
  reason: string;
}

// Routing Service Interface
export interface RoutingService {
  selectAgent(request: RoutingRequest): Promise<RoutingResult | null>;
  getAvailableAgents(): Agent[];
  getAgentLoad(agentId: string): number;
}

// Routing Service Implementation
export class LoadBalancingRouter implements RoutingService {
  private db: Db;
  private logger: Logger;

  constructor(db: Db, logger: Logger) {
    this.db = db;
    this.logger = logger;
  }

  /**
   * Select the best agent for a request based on load balancing priorities
   * Priority order:
   * 1. Agent with zero pending requests and model loaded
   * 2. Agent with zero pending requests and model installed (but not loaded)
   * 3. Agent with least pending requests and model loaded
   * 4. Agent with least pending requests and model installed (but not loaded)
   * In case of tie, use ID order
   */
  async selectAgent(request: RoutingRequest): Promise<RoutingResult | null> {
    const connectedAgents = this.db.getConnectedAgents();

    if (connectedAgents.length === 0) {
      this.logger.noAvailableAgents(request.requestId);
      return null;
    }

    // For now, we'll assume all agents have all models loaded
    // In a real implementation, we'd check which agents have the specific model
    const agentsWithModel = connectedAgents.filter(
      (agent) =>
        agent.capabilities.includes(request.model) ||
        agent.capabilities.length === 0
    );

    if (agentsWithModel.length === 0) {
      this.logger.warn("No agents available with requested model", {
        requestId: request.requestId,
        model: request.model,
        availableAgents: connectedAgents.length,
      });
      return null;
    }

    // Sort agents by priority criteria
    const sortedAgents = agentsWithModel.sort((a, b) => {
      // Primary sort: by pending requests (ascending)
      if (a.pending_requests !== b.pending_requests) {
        return a.pending_requests - b.pending_requests;
      }

      // Secondary sort: by ID (ascending) for deterministic selection
      return a.id.localeCompare(b.id);
    });

    const selectedAgent = sortedAgents[0];

    if (!selectedAgent) {
      this.logger.noAvailableAgents(request.requestId);
      return null;
    }

    const reason = this.generateSelectionReason(
      selectedAgent,
      sortedAgents,
      request
    );

    this.logger.agentSelected(selectedAgent.id, request.requestId, reason);

    return {
      agent: selectedAgent,
      reason,
    };
  }

  private generateSelectionReason(
    selectedAgent: Agent,
    allAgents: Agent[],
    request: RoutingRequest
  ): string {
    const minPendingRequests = Math.min(
      ...allAgents.map((a) => a.pending_requests)
    );
    const agentsWithMinLoad = allAgents.filter(
      (a) => a.pending_requests === minPendingRequests
    );

    if (agentsWithMinLoad.length === 1) {
      return `Selected agent with lowest load (${selectedAgent.pending_requests} pending requests)`;
    } else {
      return `Selected agent among ${agentsWithMinLoad.length} agents with equal lowest load (${selectedAgent.pending_requests} pending requests)`;
    }
  }

  getAvailableAgents(): Agent[] {
    return this.db.getConnectedAgents();
  }

  getAgentLoad(agentId: string): number {
    const agent = this.db.getAgent(agentId);
    return agent ? agent.pending_requests : -1;
  }
}
