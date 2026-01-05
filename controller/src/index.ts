import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { upgradeWebSocket, websocket } from "hono/bun";
import { RPC } from "@piercer/rpc";
import { BunTransport } from "./utils/bun-transport";
import { BunDatabase } from "./services/db";
import type { Db } from "./services/db";
import { PinoLogger } from "./services/logger";
import type { Logger } from "./services/logger";
import { AgentManager } from "./services/agents";
import { LoadBalancingRouter } from "./services/routing";
import type { RoutingService } from "./services/routing";
import { ModelMappingsService } from "./services/mappings";
import type { MappingsService } from "./services/mappings";
import { PiercerWebSocketHandler } from "./apis/websocket";
import type { WebSocketHandler } from "./apis/websocket";
import { OpenAIAPIHandler } from "./apis/openai";
import { ManagementAPIHandler } from "./apis/management";

// Environment configuration
interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  corsOrigin: string;
  logLevel: string;
  apiKey?: string;
  agentSecretKey?: string;
}

const config: AppConfig = {
  port: parseInt(process.env.PORT || "4080", 10),
  host: process.env.HOST || "0.0.0.0",
  databasePath: process.env.DATABASE_PATH || "./piercer.db",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  logLevel: process.env.LOG_LEVEL || "info",
  apiKey: process.env.API_KEY,
  agentSecretKey: process.env.AGENT_SECRET_KEY,
};

// Dependency Injection Container
class DIContainer {
  private db: Db;
  private logger: Logger;
  private wsHandlerInstance: PiercerWebSocketHandler;
  private routingService: RoutingService;
  private mappingsService: MappingsService;
  private openaiHandler: OpenAIAPIHandler;
  private managementHandler: ManagementAPIHandler;
  private agentManager: AgentManager;
  private rpc: RPC<any>;
  private transport: BunTransport;

  constructor(config: AppConfig) {
    // Initialize logger first (needed by other services)
    this.logger = new PinoLogger({ level: config.logLevel });

    // Initialize database
    this.db = new BunDatabase(config.databasePath);

    // Initialize agent manager
    this.agentManager = new AgentManager(this.db, this.logger);

    // Initialize Transport
    this.transport = new BunTransport();

    // Initialize RPC
    this.rpc = new RPC(this.transport);

    // Initialize WebSocket handler with dependencies
    this.wsHandlerInstance = new PiercerWebSocketHandler(
      this.db,
      this.logger,
      this.agentManager,
      this.transport,
      config.agentSecretKey
    );

    this.rpc.expose(this.wsHandlerInstance.getAgentAPI());
    this.wsHandlerInstance.setRpc(this.rpc);

    // Initialize routing service
    this.routingService = new LoadBalancingRouter(
      this.agentManager,
      this.logger
    );

    // Initialize mappings service
    this.mappingsService = new ModelMappingsService(this.db, this.logger);

    // Initialize OpenAI API handler
    this.openaiHandler = new OpenAIAPIHandler({
      db: this.db,
      logger: this.logger,
      routingService: this.routingService,
      mappingsService: this.mappingsService,
      agentManager: this.agentManager,
      wsHandler: this.wsHandlerInstance,
      apiKey: config.apiKey,
    });

    // Initialize Management API handler
    this.managementHandler = new ManagementAPIHandler({
      db: this.db,
      logger: this.logger,
      agentManager: this.agentManager,
      mappingsService: this.mappingsService,
      wsHandler: this.wsHandlerInstance,
    });
  }

  getDb(): Db {
    return this.db;
  }

  getLogger(): Logger {
    return this.logger;
  }

  getWebSocketHandler(): WebSocketHandler {
    return this.wsHandlerInstance;
  }

  getTransport(): BunTransport {
    return this.transport;
  }

  getRoutingService(): RoutingService {
    return this.routingService;
  }

  getMappingsService(): MappingsService {
    return this.mappingsService;
  }

  getOpenAIHandler(): OpenAIAPIHandler {
    return this.openaiHandler;
  }

  getManagementHandler(): ManagementAPIHandler {
    return this.managementHandler;
  }

  async shutdown(): Promise<void> {
    this.wsHandlerInstance.shutdown();
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
  upgradeWebSocket((c) => {
    const wsHandler = container.getWebSocketHandler();
    const transport = container.getTransport();

    return {
      onOpen: (evt, ws) => {
        wsHandler.handleConnection(ws, c.req.raw);
      },
      onMessage: (evt, ws) => {
        transport.handleMessage(ws, evt.data);
      },
      onClose: (evt, ws) => {
        wsHandler.handleDisconnection(ws, evt.code, evt.reason);
      },
      onError: (evt, ws) => {
        wsHandler.handleError(
          ws,
          (evt as any).error || new Error("Unknown WebSocket error")
        );
      },
    };
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
      completions: "/v1/completions",
      chatCompletions: "/v1/chat/completions",
      models: "/v1/models",
    },
    connectedAgents: container.getWebSocketHandler().getConnectedAgents()
      .length,
  });
});

// ============================================
// OpenAI-Compatible API Endpoints
// ============================================

// OpenAI API key validation middleware
app.use("/v1/*", async (c, next) => {
  const handler = container.getOpenAIHandler();
  const middleware = handler.validateAPIKey();
  return middleware(c, next);
});

// Request ID middleware for OpenAI endpoints
app.use("/v1/*", async (c, next) => {
  const handler = container.getOpenAIHandler();
  const middleware = handler.addRequestId();
  await middleware(c, next);
  await next();
});

// Rate limiting middleware for OpenAI endpoints
app.use("/v1/*", async (c, next) => {
  const handler = container.getOpenAIHandler();
  const middleware = handler.rateLimit();
  return middleware(c, next);
});

// Legacy Completions API
app.post("/v1/completions", async (c) => {
  const handler = container.getOpenAIHandler();
  return handler.handleCompletions(c);
});

// Chat Completions API
app.post("/v1/chat/completions", async (c) => {
  const handler = container.getOpenAIHandler();
  return handler.handleChatCompletions(c);
});

// Models API
app.get("/v1/models", async (c) => {
  const handler = container.getOpenAIHandler();
  return handler.handleModels(c);
});

// ============================================
// Management API Endpoints
// ============================================

app.get("/management/agents", (c) => {
  const handler = container.getManagementHandler();
  return handler.listAgents(c);
});

app.post("/management/mappings", (c) => {
  const handler = container.getManagementHandler();
  return handler.createModelMapping(c);
});

app.get("/management/mappings", (c) => {
  const handler = container.getManagementHandler();
  return handler.listModelMappings(c);
});

app.delete("/management/mappings/:publicName", (c) => {
  const handler = container.getManagementHandler();
  return handler.deleteModelMapping(c);
});

app.post("/management/agents/:agentId/models/download", (c) => {
  const handler = container.getManagementHandler();
  return handler.downloadModel(c);
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
container
  .getLogger()
  .info(`Completions API: http://${config.host}:${config.port}/v1/completions`);
container
  .getLogger()
  .info(
    `Chat Completions API: http://${config.host}:${config.port}/v1/chat/completions`
  );
container
  .getLogger()
  .info(`Models API: http://${config.host}:${config.port}/v1/models`);

// Export for testing
export default app;
