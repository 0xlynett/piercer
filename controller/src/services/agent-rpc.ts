import type { Logger } from "./logger";
import type { AgentManager } from "./agents";
import type { RPC } from "@piercer/rpc";
import type { AgentFunctions, ControllerFunctions } from "../rpc-types";

export class AgentRPCService {
  private rpc: RPC<ControllerFunctions> | null = null;

  constructor(private agentManager: AgentManager, private logger: Logger) {}

  public setRpc(rpc: RPC<ControllerFunctions>) {
    this.rpc = rpc;
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
  public handleAgentError(params: any): void {
    this.logger.error("Agent error", new Error(params.error), {
      agentId: params.agentId,
      context: params.context,
    });
  }

  public handleReceiveCompletion(params: any): void {
    const { requestId, data } = params;

    const cleanup = () => {
      const agentId = this.agentManager.unbindRequestFromAgent(requestId);
      if (agentId) {
        this.agentManager.decrementPendingRequests(agentId);
      }
    };

    // Check if this is a streaming request (has a stream controller)
    const streamController = this.agentManager.getStream(requestId);

    // Check if this is a non-streaming request (has a completion buffer)
    const completionBuffer = this.agentManager.getCompletionBuffer(requestId);

    if (!streamController && !completionBuffer) {
      this.logger.warn(`Received completion for unknown request: ${requestId}`);
      return;
    }

    // Handle streaming requests
    if (streamController) {
      try {
        if (data === "[DONE]") {
          streamController.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          streamController.close();
          this.agentManager.removeStream(requestId);
          cleanup();
        } else {
          // Assume data is the chunk object
          const chunkData = `data: ${JSON.stringify(data)}\n\n`;
          streamController.enqueue(new TextEncoder().encode(chunkData));
        }
      } catch (error) {
        this.logger.error(
          `Error writing to stream for request ${requestId}`,
          error as Error
        );
        try {
          streamController.error(error);
        } catch (e) {
          // Ignore error if stream is already closed
        }
        this.agentManager.removeStream(requestId);
        cleanup();
      }
      return;
    }

    // Handle non-streaming requests (accumulate chunks in buffer)
    if (completionBuffer) {
      try {
        if (data === "[DONE]") {
          // Combine all chunks and resolve the Promise
          this.agentManager.resolveCompletionBuffer(
            requestId,
            completionBuffer.chunks
          );
          cleanup();
        } else {
          // Accumulate chunk in the buffer
          this.agentManager.addChunkToBuffer(requestId, data);
        }
      } catch (error) {
        this.logger.error(
          `Error processing non-streaming completion for request ${requestId}`,
          error as Error
        );
        this.agentManager.rejectCompletionBuffer(requestId, error);
        cleanup();
      }
    }
  }
}
