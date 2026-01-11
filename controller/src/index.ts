import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { upgradeWebSocket, websocket } from "hono/bun";
import { OpenAPIHono } from "@hono/zod-openapi";
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
import { AgentRPCService } from "./services/agent-rpc";
import { PiercerWebSocketHandler } from "./apis/websocket";
import type { WebSocketHandler } from "./apis/websocket";
import { OpenAIAPIHandler } from "./apis/openai";
import { ManagementAPIHandler } from "./apis/management";
import {
  CompletionsRoute,
  ChatCompletionsRoute,
  ListModelsRoute,
  ListAgentsRoute,
  ListMappingsRoute,
  CreateMappingRoute,
  DeleteMappingRoute,
  DownloadModelRoute,
  HealthRoute,
  APIInfoRoute,
  OpenAPIInfo,
} from "./apis/openapi";

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
  private agentRPCService: AgentRPCService;
  private rpc: RPC<any>;
  private transport: BunTransport;

  constructor(config: AppConfig) {
    // Initialize logger first (needed by other services)
    this.logger = new PinoLogger({ level: config.logLevel });

    // Initialize database
    this.db = new BunDatabase(config.databasePath);

    // Initialize agent manager
    this.agentManager = new AgentManager(this.db, this.logger);

    // Initialize Agent RPC Service
    this.agentRPCService = new AgentRPCService(this.agentManager, this.logger);

    // Initialize Transport
    this.transport = new BunTransport();

    // Initialize RPC
    this.rpc = new RPC(this.transport);
    this.agentRPCService.setRpc(this.rpc);

    // Initialize WebSocket handler with dependencies
    this.wsHandlerInstance = new PiercerWebSocketHandler(
      this.db,
      this.logger,
      this.agentManager,
      this.transport,
      this.agentRPCService,
      config.agentSecretKey
    );

    this.rpc.expose(this.wsHandlerInstance.getAgentAPI());

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
      agentRPCService: this.agentRPCService,
      apiKey: config.apiKey,
    });

    // Initialize Management API handler
    this.managementHandler = new ManagementAPIHandler({
      db: this.db,
      logger: this.logger,
      agentManager: this.agentManager,
      mappingsService: this.mappingsService,
      agentRPCService: this.agentRPCService,
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
        console.log("Server received raw message:", evt.data);
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

// ============================================
// OpenAPI Documentation Endpoint
// ============================================

// OpenAPI JSON documentation endpoint
app.get("/openapi.json", (c) => {
  const baseURL = `http://${config.host}:${config.port}`;

  const openapiSpec = {
    ...OpenAPIInfo,
    servers: [
      {
        url: baseURL,
        description: "Piercer Controller",
      },
    ],
    paths: {
      "/v1/completions": {
        post: {
          tags: ["OpenAI API"],
          summary: "Create a completion",
          description:
            "Creates a completion for the given prompt using the specified model.",
          operationId: "createCompletion",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CompletionRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful completion response",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/CompletionResponse",
                  },
                },
              },
            },
            "400": {
              description: "Invalid request",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            "503": {
              description: "No agents available",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/v1/chat/completions": {
        post: {
          tags: ["OpenAI API"],
          summary: "Create a chat completion",
          description:
            "Creates a chat completion for the given messages using the specified model.",
          operationId: "createChatCompletion",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ChatCompletionRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful chat completion response",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChatCompletionResponse",
                  },
                },
              },
            },
            "400": {
              description: "Invalid request",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            "503": {
              description: "No agents available",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/v1/models": {
        get: {
          tags: ["OpenAI API"],
          summary: "List available models",
          description:
            "Returns a list of available models that can be used with the API.",
          operationId: "listModels",
          responses: {
            "200": {
              description: "Successful models list response",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ModelsResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/health": {
        get: {
          tags: ["Utility"],
          summary: "Health check",
          description: "Returns the health status of the server.",
          operationId: "healthCheck",
          responses: {
            "200": {
              description: "Server is healthy",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/HealthResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/info": {
        get: {
          tags: ["Utility"],
          summary: "API information",
          description: "Returns information about the API and its endpoints.",
          operationId: "apiInfo",
          responses: {
            "200": {
              description: "API information",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/APIInfoResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/management/agents": {
        get: {
          tags: ["Management"],
          summary: "List connected agents",
          description:
            "Returns a list of all connected agents and their status.",
          operationId: "listAgents",
          responses: {
            "200": {
              description: "Successful agents list response",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/AgentInfo",
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/management/mappings": {
        get: {
          tags: ["Management"],
          summary: "List model mappings",
          description:
            "Returns a list of all model mappings that translate public names to internal filenames.",
          operationId: "listMappings",
          responses: {
            "200": {
              description: "Successful mappings list response",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/ModelMapping",
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Management"],
          summary: "Create a model mapping",
          description:
            "Creates a new model mapping that translates a public name to an internal filename.",
          operationId: "createMapping",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CreateMappingRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Mapping created successfully",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/CreateMappingResponse",
                  },
                },
              },
            },
            "400": {
              description: "Invalid request",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/management/mappings/{publicName}": {
        delete: {
          tags: ["Management"],
          summary: "Delete a model mapping",
          description: "Deletes a model mapping by its public name.",
          operationId: "deleteMapping",
          parameters: [
            {
              name: "publicName",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          responses: {
            "200": {
              description: "Mapping deleted successfully",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/CreateMappingResponse",
                  },
                },
              },
            },
            "404": {
              description: "Mapping not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/management/agents/{agentId}/models/download": {
        post: {
          tags: ["Management"],
          summary: "Download a model to an agent",
          description:
            "Triggers a model download on a specific agent from the given URL.",
          operationId: "downloadModel",
          parameters: [
            {
              name: "agentId",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/DownloadModelRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Download triggered successfully",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/DownloadModelResponse",
                  },
                },
              },
            },
            "404": {
              description: "Agent not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            "500": {
              description: "Download failed",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        CompletionRequest: {
          type: "object",
          required: ["model", "prompt"],
          properties: {
            model: {
              type: "string",
              description: "Model to use for completion",
            },
            prompt: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
              description: "Prompt to complete",
            },
            max_tokens: {
              type: "integer",
              minimum: 0,
              description: "Maximum tokens to generate",
            },
            temperature: {
              type: "number",
              minimum: 0,
              maximum: 2,
              description: "Sampling temperature",
            },
            top_p: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Top-p sampling",
            },
            n: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              description: "Number of completions",
            },
            stream: { type: "boolean", description: "Stream results" },
            logprobs: {
              type: "boolean",
              description: "Return log probabilities",
            },
            echo: { type: "boolean", description: "Echo prompt" },
            stop: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
              description: "Stop sequences",
            },
            presence_penalty: {
              type: "number",
              minimum: -2,
              maximum: 2,
              description: "Presence penalty",
            },
            frequency_penalty: {
              type: "number",
              minimum: -2,
              maximum: 2,
              description: "Frequency penalty",
            },
            best_of: {
              type: "integer",
              description: "Generate best_of completions",
            },
            logit_bias: {
              type: "object",
              additionalProperties: { type: "number" },
              description: "Logit bias for tokens",
            },
            user: { type: "string", description: "User identifier" },
          },
        },
        CompletionResponse: {
          type: "object",
          properties: {
            id: { type: "string", description: "Completion ID" },
            object: {
              type: "string",
              enum: ["text_completion"],
              description: "Object type",
            },
            created: { type: "integer", description: "Creation timestamp" },
            model: { type: "string", description: "Model used" },
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", description: "Choice index" },
                  text: { type: "string", description: "Generated text" },
                  logprobs: {
                    type: "object",
                    nullable: true,
                    description: "Log probabilities",
                  },
                  finish_reason: {
                    type: "string",
                    description: "Reason for finishing",
                  },
                },
              },
            },
            usage: {
              type: "object",
              properties: {
                prompt_tokens: {
                  type: "integer",
                  description: "Tokens in prompt",
                },
                completion_tokens: {
                  type: "integer",
                  description: "Tokens in completion",
                },
                total_tokens: { type: "integer", description: "Total tokens" },
              },
            },
          },
        },
        ChatMessage: {
          type: "object",
          properties: {
            role: {
              type: "string",
              enum: ["system", "user", "assistant", "tool"],
              description: "Message role",
            },
            content: { type: "string", description: "Message content" },
            name: { type: "string", description: "Message author name" },
            tool_calls: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Tool call ID" },
                  type: {
                    type: "string",
                    enum: ["function"],
                    description: "Tool call type",
                  },
                  function: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Function name" },
                      arguments: {
                        type: "string",
                        description: "Function arguments",
                      },
                    },
                  },
                },
              },
            },
            tool_call_id: {
              type: "string",
              description: "Tool call response ID",
            },
          },
        },
        ChatCompletionRequest: {
          type: "object",
          required: ["model", "messages"],
          properties: {
            model: {
              type: "string",
              description: "Model to use for chat completion",
            },
            messages: {
              type: "array",
              items: { $ref: "#/components/schemas/ChatMessage" },
              description: "Conversation messages",
            },
            max_tokens: {
              type: "integer",
              minimum: 0,
              description: "Maximum tokens to generate",
            },
            temperature: {
              type: "number",
              minimum: 0,
              maximum: 2,
              description: "Sampling temperature",
            },
            top_p: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Top-p sampling",
            },
            n: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              description: "Number of completions",
            },
            stream: { type: "boolean", description: "Stream results" },
            stop: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
              description: "Stop sequences",
            },
            presence_penalty: {
              type: "number",
              minimum: -2,
              maximum: 2,
              description: "Presence penalty",
            },
            frequency_penalty: {
              type: "number",
              minimum: -2,
              maximum: 2,
              description: "Frequency penalty",
            },
            logprobs: {
              type: "boolean",
              description: "Return log probabilities",
            },
            top_logprobs: {
              type: "integer",
              description: "Number of top logprobs",
            },
            user: { type: "string", description: "User identifier" },
          },
        },
        ChatCompletionResponse: {
          type: "object",
          properties: {
            id: { type: "string", description: "Completion ID" },
            object: {
              type: "string",
              enum: ["chat.completion"],
              description: "Object type",
            },
            created: { type: "integer", description: "Creation timestamp" },
            model: { type: "string", description: "Model used" },
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", description: "Choice index" },
                  message: {
                    $ref: "#/components/schemas/ChatMessage",
                    description: "Response message",
                  },
                  logprobs: {
                    type: "object",
                    nullable: true,
                    description: "Log probabilities",
                  },
                  finish_reason: {
                    type: "string",
                    description: "Reason for finishing",
                  },
                },
              },
            },
            usage: {
              type: "object",
              properties: {
                prompt_tokens: {
                  type: "integer",
                  description: "Tokens in prompt",
                },
                completion_tokens: {
                  type: "integer",
                  description: "Tokens in completion",
                },
                total_tokens: { type: "integer", description: "Total tokens" },
              },
            },
          },
        },
        ModelsResponse: {
          type: "object",
          properties: {
            object: {
              type: "string",
              enum: ["list"],
              description: "Object type",
            },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Model ID" },
                  object: {
                    type: "string",
                    enum: ["model"],
                    description: "Object type",
                  },
                  created: {
                    type: "integer",
                    description: "Creation timestamp",
                  },
                  owned_by: { type: "string", description: "Model owner" },
                },
              },
            },
          },
        },
        AgentInfo: {
          type: "object",
          properties: {
            id: { type: "string", description: "Agent unique identifier" },
            name: { type: "string", description: "Agent human-readable name" },
            status: {
              type: "string",
              enum: [
                "connected",
                "disconnected",
                "loading_model",
                "processing",
              ],
              description: "Agent status",
            },
            loaded_models: {
              type: "array",
              items: { type: "string" },
              description: "Models currently loaded",
            },
            pending_requests: {
              type: "integer",
              description: "Number of pending requests",
            },
            last_seen: { type: "string", description: "Last seen timestamp" },
            vram_total: { type: "integer", description: "Total VRAM in bytes" },
            vram_used: { type: "integer", description: "Used VRAM in bytes" },
          },
        },
        ModelMapping: {
          type: "object",
          properties: {
            id: { type: "integer", description: "Mapping ID" },
            public_name: { type: "string", description: "Public model name" },
            filename: { type: "string", description: "Internal filename" },
            created_at: { type: "integer", description: "Creation timestamp" },
          },
        },
        CreateMappingRequest: {
          type: "object",
          required: ["public_name", "filename"],
          properties: {
            public_name: { type: "string", description: "Public model name" },
            filename: { type: "string", description: "Internal filename" },
          },
        },
        CreateMappingResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", description: "Success status" },
          },
        },
        DownloadModelRequest: {
          type: "object",
          required: ["model_url", "filename"],
          properties: {
            model_url: {
              type: "string",
              description: "URL to download model from",
            },
            filename: { type: "string", description: "Filename to save as" },
          },
        },
        DownloadModelResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", description: "Success status" },
            result: { type: "string", description: "Download result" },
          },
        },
        HealthResponse: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["healthy"],
              description: "Health status",
            },
            timestamp: { type: "string", description: "Current timestamp" },
            uptime: { type: "number", description: "Server uptime in seconds" },
            connected_agents: {
              type: "integer",
              description: "Number of connected agents",
            },
          },
        },
        APIInfoResponse: {
          type: "object",
          properties: {
            name: { type: "string", description: "API name" },
            version: { type: "string", description: "API version" },
            description: { type: "string", description: "API description" },
            endpoints: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Available endpoints",
            },
            connected_agents: {
              type: "integer",
              description: "Number of connected agents",
            },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: { type: "string", description: "Error message" },
                type: { type: "string", description: "Error type" },
                code: { type: "string", description: "Error code" },
                param: {
                  type: "string",
                  description: "Parameter that caused the error",
                },
              },
            },
          },
        },
      },
    },
  };

  return c.json(openapiSpec, 200, {
    "Access-Control-Allow-Origin": "*",
  });
});

// Swagger UI endpoint - redirects to external swagger
app.get("/docs", (c) => {
  const baseURL = `http://${config.host}:${config.port}`;
  return c.redirect(`${baseURL}/openapi.json`);
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
export const server = Bun.serve({
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

// Export for testing and CLI client
export default app;
export type AppType = typeof app;
