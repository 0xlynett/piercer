/**
 * Piercer Agent - Production LLM Inference Agent
 * Uses node-llama-cpp for inference, connects to controller via WebSocket RPC
 */

import { RPC, WebSocketTransport } from "@piercer/rpc";
import { AgentService } from "./src/agent-service.js";
import { loadConfig } from "./src/config.js";
import { logger } from "./src/utils/logger.js";

// Reconnection configuration
const RECONNECT_MIN_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 60000; // 60 seconds
const MAX_RECONNECT_ATTEMPTS = 10;

let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentTransport: WebSocketTransport | null = null;

// Load configuration
const config = loadConfig();

logger.info({ config: { ...config, agentSecretKey: "***" } }, "Starting agent");

// Initialize agent service
const agentService = new AgentService(config);

// Helper to serialize error for logging
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.parse(JSON.stringify(error));
    } catch {
      return { raw: String(error) };
    }
  }
  return { value: error };
}

// Refresh connection - only refreshes websocket/RPC layer, not full initialization
const refreshConnection = async () => {
  const agentId = agentService.getAgentId();
  const agentName = agentService.getAgentName();
  const installedModels = await agentService.getInstalledModels();

  logger.info(
    { controllerUrl: config.controllerUrl, agentId, agentName },
    "Connecting to controller"
  );

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

  // Track if we've set up watching for this connection
  let watchingStarted = false;

  // Connection events
  transport.on("open", async () => {
    logger.info("Connected to controller");
    reconnectAttempts = 0; // Reset reconnect counter on successful connection

    // Start watching models folder only after connection is established
    // This ensures the initial model notification goes through
    if (!watchingStarted) {
      watchingStarted = true;
      try {
        await agentService.startWatching();
      } catch (watchError) {
        logger.error(
          { error: serializeError(watchError) },
          "Failed to start watching models folder"
        );
        // Don't throw - watching is not critical for startup
      }
    }
  });

  transport.on("close", (code: number, reason: string) => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    handleDisconnect(code, reason);
  });

  transport.on("error", (err: any) => {
    logger.error({ error: serializeError(err) }, "Transport error");
  });

  // Note: WebSocketTransport connects automatically in constructor
  // No explicit connect() call needed

  // Update current transport reference
  currentTransport = transport;

  return transport;
};

const handleDisconnect = (code: number, reason: string) => {
  logger.warn({ code, reason }, "Disconnected from controller");

  // If kicked due to duplicate ID, exit immediately
  if (code === 1001) {
    logger.info("Exiting due to being replaced by new connection");
    process.exit(0);
    return;
  }

  // Auth failure - don't reconnect (misconfiguration)
  if (code === 1008) {
    logger.error("Authentication failed, not reconnecting");
    process.exit(1);
    return;
  }

  // Calculate delay with exponential backoff
  const delay = Math.min(
    RECONNECT_MIN_DELAY * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_DELAY
  );

  reconnectAttempts++;

  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    logger.error("Max reconnection attempts reached, exiting");
    process.exit(1);
    return;
  }

  logger.info({ attempt: reconnectAttempts, delay }, "Scheduling reconnect");

  reconnectTimer = setTimeout(async () => {
    try {
      await refreshConnection();
      logger.info("Successfully reconnected");
    } catch (error) {
      logger.error({ error: serializeError(error) }, "Reconnection failed");
    }
  }, delay);
};

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, "Received shutdown signal");

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    if (currentTransport) {
      currentTransport.close();
    }
    await agentService.shutdown();
    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error({ error: serializeError(error) }, "Error during shutdown");
    process.exit(1);
  }
};

// Initialize and start
(async () => {
  try {
    await agentService.initialize();

    const agentId = agentService.getAgentId();
    const agentName = agentService.getAgentName();

    logger.info(
      {
        agentId,
        agentName,
      },
      "Agent initialized"
    );

    await refreshConnection();

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Keep alive
    setInterval(() => {}, 1000);

    logger.info("Agent running");
  } catch (error) {
    logger.error(
      { error: serializeError(error) },
      "Fatal error during agent startup"
    );
    process.exit(1);
  }
})();
