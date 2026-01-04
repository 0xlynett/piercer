import type { Db } from "./db";
import type { Logger } from "./logger";
import type { AgentManager, Agent } from "./agents";

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
  private agentManager: AgentManager;
  private logger: Logger;

  constructor(agentManager: AgentManager, logger: Logger) {
    this.agentManager = agentManager;
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
    const connectedAgents = this.agentManager.getAllAgents();

    if (connectedAgents.length === 0) {
      this.logger.noAvailableAgents(request.requestId);
      return null;
    }

    const agentsWithModel = connectedAgents.filter((agent) => {
      const installedModels = this.agentManager.getInstalledModels(agent.id);
      return installedModels.includes(request.model);
    });

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
      const aPending = this.agentManager.getPendingRequests(a.id);
      const bPending = this.agentManager.getPendingRequests(b.id);
      const aLoaded = this.agentManager
        .getLoadedModels(a.id)
        .includes(request.model);
      const bLoaded = this.agentManager
        .getLoadedModels(b.id)
        .includes(request.model);

      // 1. Agent with zero pending requests and model loaded
      if (aPending === 0 && aLoaded && (bPending !== 0 || !bLoaded)) return -1;
      if (bPending === 0 && bLoaded && (aPending !== 0 || !aLoaded)) return 1;

      // 2. Agent with zero pending requests and model installed (but not loaded)
      if (aPending === 0 && !aLoaded && (bPending !== 0 || bLoaded)) return -1;
      if (bPending === 0 && !bLoaded && (aPending !== 0 || aLoaded)) return 1;

      // 3. Agent with least pending requests and model loaded
      if (aLoaded && !bLoaded) return -1;
      if (bLoaded && !aLoaded) return 1;
      if (aLoaded && bLoaded) {
        if (aPending !== bPending) {
          return aPending - bPending;
        }
      }

      // 4. Agent with least pending requests and model installed (but not loaded)
      if (aPending !== bPending) {
        return aPending - bPending;
      }

      // Tie-breaker
      return a.id.localeCompare(b.id);
    });

    const selectedAgent = sortedAgents[0];

    if (!selectedAgent) {
      this.logger.noAvailableAgents(request.requestId);
      return null;
    }

    const reason = ""; // TODO: generate reason

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
    // This is a placeholder. A more sophisticated reason can be generated
    // based on the sorting logic.
    return `Agent ${selectedAgent.name} was selected.`;
  }

  getAvailableAgents(): Agent[] {
    return this.agentManager.getAllAgents();
  }

  getAgentLoad(agentId: string): number {
    return this.agentManager.getPendingRequests(agentId);
  }
}
