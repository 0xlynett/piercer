import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { upgradeWebSocket, websocket } from "hono/bun";
import { createHonoWebSocketHandler } from "kkrpc";
import { BunDatabase } from "./services/db";
import type { Db } from "./services/db";
import { PinoLogger } from "./services/logger";
import type { Logger } from "./services/logger";
import { KkrpcWebSocketHandler } from "./apis/websocket";
import type { WebSocketHandler } from "./apis/websocket";

// Environment configuration
interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  corsOrigin: string;
  logLevel: string;
}

const config: AppConfig = {
  port: parseInt(process.env.PORT || "4080", 10),
  host: process.env.HOST || "0.0.0.0",
  databasePath: process.env.DATABASE_PATH || "./piercer.db",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  logLevel: process.env.LOG_LEVEL || "info",
};

// Dependency Injection Container
class DIContainer {
  private db: Db;
  private logger: Logger;
  private wsHandler: WebSocketHandler;

  constructor(config: AppConfig) {
    // Initialize logger first (needed by other services)
    this.logger = new PinoLogger({ level: config.logLevel });

    // Initialize database
    this.db = new BunDatabase(config.databasePath);

    // Initialize WebSocket handler with dependencies
    this.wsHandler = new KkrpcWebSocketHandler(this.db, this.logger);
  }

  getDb(): Db {
    return this.db;
  }

  getLogger(): Logger {
    return this.logger;
  }

  getWebSocketHandler(): WebSocketHandler {
    return this.wsHandler;
  }

  async shutdown(): Promise<void> {
    this.wsHandler.shutdown();
    this.db.close();
  }
}

// Initialize dependency injection container
const container = new DIContainer(config);

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
    container.getLogger().info(message);
  })
);

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connectedAgents: container.getWebSocketHandler().getConnectedAgents()
      .length,
  });
});

// WebSocket endpoint for agent connections
app.get(
  "/ws",
  upgradeWebSocket(() => {
    return createHonoWebSocketHandler({
      expose: container.getWebSocketHandler().getAgentAPI(),
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
    connectedAgents: container.getWebSocketHandler().getConnectedAgents()
      .length,
  });
});

// Error handling middleware
app.onError((err, c) => {
  container.getLogger().error("Request error", err, {
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
const gracefulShutdown = async (signal: string) => {
  container
    .getLogger()
    .info(`Received ${signal}, starting graceful shutdown...`);

  await container.shutdown();

  container.getLogger().info("Graceful shutdown completed");
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

container.getLogger().info("Piercer Controller starting", {
  port: config.port,
  host: config.host,
  databasePath: config.databasePath,
  corsOrigin: config.corsOrigin,
  logLevel: config.logLevel,
});

container
  .getLogger()
  .info(`Server running on http://${config.host}:${config.port}`);
container
  .getLogger()
  .info(`WebSocket endpoint: ws://${config.host}:${config.port}/ws`);
container
  .getLogger()
  .info(`Health check: http://${config.host}:${config.port}/health`);
container
  .getLogger()
  .info(`API info: http://${config.host}:${config.port}/api/info`);

// Export for testing
export default app;
