import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { upgradeWebSocket, websocket } from "hono/bun";
import { createHonoWebSocketHandler } from "kkrpc";
import { DatabaseService } from "./services/db.js";
import { logger } from "./services/logger.js";
import { WebSocketHandler } from "./apis/websocket.js";

// Environment configuration
const config = {
  port: parseInt(process.env.PORT || "4080", 10),
  host: process.env.HOST || "0.0.0.0",
  databasePath: process.env.DATABASE_PATH || "./piercer.db",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  logLevel: process.env.LOG_LEVEL || "info",
};

// Initialize database
const db = new DatabaseService(config.databasePath);

// Initialize WebSocket handler
const wsHandler = new WebSocketHandler(db);

// Create Hono app
const app = new Hono();

// CORS middleware
app.use(
  "/*",
  cors({
    origin: config.corsOrigin,
    allowHeaders: ["Content-Type", "Authorization", "agent-id", "agent-name"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Logging middleware
app.use(
  honoLogger((message) => {
    logger.info(message);
  })
);

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connectedAgents: wsHandler.getConnectedAgents().length,
  });
});

// WebSocket endpoint for agent connections
app.get(
  "/ws",
  upgradeWebSocket(() => {
    return createHonoWebSocketHandler({
      expose: wsHandler.getAgentAPI(),
    });
  })
);

// Basic API info endpoint
app.get("/api/info", (c) => {
  return c.json({
    name: "Piercer Controller",
    version: "1.0.0",
    description: "LLM request load balancer controller",
    endpoints: {
      websocket: "/ws",
      health: "/health",
      api: "/api/info",
    },
    connectedAgents: wsHandler.getConnectedAgents().length,
  });
});

// Error handling middleware
app.onError((err, c) => {
  logger.error("Request error", err, {
    path: c.req.path,
    method: c.req.method,
    userAgent: c.req.header("user-agent"),
  });

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
      },
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.path} not found`,
      },
    },
    404
  );
});

// Graceful shutdown handling
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Close database connections
  db.close();

  // Shutdown WebSocket handler
  wsHandler.shutdown();

  logger.info("Graceful shutdown completed");
  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
  websocket,
});

logger.info("Piercer Controller starting", {
  port: config.port,
  host: config.host,
  databasePath: config.databasePath,
  corsOrigin: config.corsOrigin,
  logLevel: config.logLevel,
});

logger.info(`Server running on http://${config.host}:${config.port}`);
logger.info(`WebSocket endpoint: ws://${config.host}:${config.port}/ws`);
logger.info(`Health check: http://${config.host}:${config.port}/health`);
logger.info(`API info: http://${config.host}:${config.port}/api/info`);

// Export for testing
export default app;
