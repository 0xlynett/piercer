/**
 * Piercer Agent - Production LLM Inference Agent
 * Uses node-llama-cpp for inference, connects to controller via WebSocket RPC
 */

import { RPC, WebSocketTransport } from "@piercer/rpc";
import { AgentService } from "./src/agent-service.js";
import { loadConfig } from "./src/config.js";
import { logger } from "./src/utils/logger.js";

// Load configuration
const config = loadConfig();

logger.info({ config: { ...config, agentSecretKey: "***" } }, "Starting agent");

// Initialize agent service
const agentService = new AgentService(config);

// Initialize and start
(async () => {
  try {
    await agentService.initialize();

    const agentId = agentService.getAgentId();
    const agentName = agentService.getAgentName();
    const installedModels = await agentService.getInstalledModels();

    logger.info(
      {
        agentId,
        agentName,
        modelCount: installedModels.length,
      },
      "Agent initialized"
    );

    // Setup WebSocket connection to controller
    const transport = new WebSocketTransport(config.controllerUrl, {
      headers: {
        authorization: `Bearer ${config.agentSecretKey}`,
        "agent-id": agentId,
        "agent-name": agentName,
        "agent-installed-models": installedModels.join(","),
      },
    });

    const rpc = new RPC(transport);

    // Expose agent functions for controller to call
    rpc.expose({
      completion: (params: any) => agentService.completion(params),
      chat: (params: any) => agentService.chat(params),
      listModels: () => agentService.listModels(),
      currentModels: () => agentService.currentModels(),
      startModel: (params: any) => agentService.startModel(params),
      downloadModel: (params: any) => agentService.downloadModel(params),
      status: () => agentService.status(),
    });

    // Get controller remote interface and set it on agent service
    const controller = rpc.remote<any>();
    agentService.setControllerRPC(controller);

    // Connection events
    transport.on("open", () => {
      logger.info("Connected to controller");
    });

    transport.on("close", () => {
      logger.warn("Disconnected from controller");
      // TODO: Implement reconnection logic
    });

    transport.on("error", (err: any) => {
      logger.error({ error: err }, "Transport error");
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Received shutdown signal");

      try {
        transport.close();
        await agentService.shutdown();
        logger.info("Shutdown complete");
        process.exit(0);
      } catch (error) {
        logger.error({ error }, "Error during shutdown");
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Keep alive
    setInterval(() => {}, 1000);

    logger.info("Agent running");
  } catch (error) {
    logger.error({ error }, "Fatal error during agent startup");
    process.exit(1);
  }
})();
