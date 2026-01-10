import { createRoute, z, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  CompletionRequestSchema,
  CompletionResponseSchema,
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
  ModelsResponseSchema,
  AgentInfoSchema,
  ModelMappingSchema,
  CreateMappingRequestSchema,
  CreateMappingResponseSchema,
  DownloadModelRequestSchema,
  DownloadModelResponseSchema,
  HealthResponseSchema,
  APIInfoResponseSchema,
  ErrorResponseSchema,
} from "./openapi-schemas";

// ============================================
// OpenAI-Compatible API Routes
// ============================================

/**
 * Legacy Completions API route
 */
export const CompletionsRoute = createRoute({
  method: "post",
  path: "/v1/completions",
  tags: ["OpenAI API"],
  summary: "Create a completion",
  description: "Creates a completion for the given prompt using the specified model.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CompletionRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Successful completion response",
      content: {
        "application/json": {
          schema: CompletionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    503: {
      description: "No agents available",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Chat Completions API route
 */
export const ChatCompletionsRoute = createRoute({
  method: "post",
  path: "/v1/chat/completions",
  tags: ["OpenAI API"],
  summary: "Create a chat completion",
  description: "Creates a chat completion for the given messages using the specified model.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ChatCompletionRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Successful chat completion response",
      content: {
        "application/json": {
          schema: ChatCompletionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    503: {
      description: "No agents available",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * List Models API route
 */
export const ListModelsRoute = createRoute({
  method: "get",
  path: "/v1/models",
  tags: ["OpenAI API"],
  summary: "List available models",
  description: "Returns a list of available models that can be used with the API.",
  responses: {
    200: {
      description: "Successful models list response",
      content: {
        "application/json": {
          schema: ModelsResponseSchema,
        },
      },
    },
  },
});

// ============================================
// Management API Routes
// ============================================

/**
 * List Agents API route
 */
export const ListAgentsRoute = createRoute({
  method: "get",
  path: "/management/agents",
  tags: ["Management"],
  summary: "List connected agents",
  description: "Returns a list of all connected agents and their status.",
  responses: {
    200: {
      description: "Successful agents list response",
      content: {
        "application/json": {
          schema: z.array(AgentInfoSchema),
        },
      },
    },
  },
});

/**
 * List Model Mappings API route
 */
export const ListMappingsRoute = createRoute({
  method: "get",
  path: "/management/mappings",
  tags: ["Management"],
  summary: "List model mappings",
  description: "Returns a list of all model mappings that translate public names to internal filenames.",
  responses: {
    200: {
      description: "Successful mappings list response",
      content: {
        "application/json": {
          schema: z.array(ModelMappingSchema),
        },
      },
    },
  },
});

/**
 * Create Model Mapping API route
 */
export const CreateMappingRoute = createRoute({
  method: "post",
  path: "/management/mappings",
  tags: ["Management"],
  summary: "Create a model mapping",
  description: "Creates a new model mapping that translates a public name to an internal filename.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateMappingRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Mapping created successfully",
      content: {
        "application/json": {
          schema: CreateMappingResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Delete Model Mapping API route
 */
export const DeleteMappingRoute = createRoute({
  method: "delete",
  path: "/management/mappings/{publicName}",
  tags: ["Management"],
  summary: "Delete a model mapping",
  description: "Deletes a model mapping by its public name.",
  request: {
    params: z.object({
      publicName: z.string().openapi({ description: "Public name of the mapping to delete" }),
    }),
  },
  responses: {
    200: {
      description: "Mapping deleted successfully",
      content: {
        "application/json": {
          schema: CreateMappingResponseSchema,
        },
      },
    },
    404: {
      description: "Mapping not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Download Model API route
 */
export const DownloadModelRoute = createRoute({
  method: "post",
  path: "/management/agents/{agentId}/models/download",
  tags: ["Management"],
  summary: "Download a model to an agent",
  description: "Triggers a model download on a specific agent from the given URL.",
  request: {
    params: z.object({
      agentId: z.string().openapi({ description: "Agent ID to download the model to" }),
    }),
    body: {
      content: {
        "application/json": {
          schema: DownloadModelRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Download triggered successfully",
      content: {
        "application/json": {
          schema: DownloadModelResponseSchema,
        },
      },
    },
    404: {
      description: "Agent not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Download failed",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// ============================================
// Utility Routes
// ============================================

/**
 * Health Check API route
 */
export const HealthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Utility"],
  summary: "Health check",
  description: "Returns the health status of the server.",
  responses: {
    200: {
      description: "Server is healthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

/**
 * API Info API route
 */
export const APIInfoRoute = createRoute({
  method: "get",
  path: "/api/info",
  tags: ["Utility"],
  summary: "API information",
  description: "Returns information about the API and its endpoints.",
  responses: {
    200: {
      description: "API information",
      content: {
        "application/json": {
          schema: APIInfoResponseSchema,
        },
      },
    },
  },
});

// ============================================
// OpenAPI App and Routes
// ============================================

/**
 * OpenAPI specification info object
 */
export const OpenAPIInfo = {
  openapi: "3.1.0",
  info: {
    title: "Piercer Controller API",
    version: "1.0.0",
    description: "LLM request load balancer controller with OpenAI-compatible API",
    contact: {
      name: "Piercer",
      url: "https://github.com/piercer/piercer",
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  },
  servers: [
    {
      url: "http://localhost:4080",
      description: "Local development server",
    },
  ],
  tags: [
    {
      name: "OpenAI API",
      description: "OpenAI-compatible API endpoints for completions and chat",
    },
    {
      name: "Management",
      description: "Management API endpoints for agents and model mappings",
    },
    {
      name: "Utility",
      description: "Utility endpoints for health checks and API information",
    },
  ],
};

/**
 * Create OpenAPI app with all routes
 */
export function createOpenAPIApp() {
  const app = new OpenAPIHono();

  // Register all routes with OpenAPI documentation
  app.openapi(CompletionsRoute, async (c) => {
    // Handler is set later via OpenAIAPIHandler
    return c.json({ error: "Not implemented" }, 500);
  });

  app.openapi(ChatCompletionsRoute, async (c) => {
    return c.json({ error: "Not implemented" }, 500);
  });

  app.openapi(ListModelsRoute, async (c) => {
    return c.json({ error: "Not implemented" }, 500);
  });

  app.openapi(ListAgentsRoute, async (c) => {
    return c.json({ error: "Not implemented" }, 500);
  });

  app.openapi(ListMappingsRoute, async (c) => {
    return c.json({ error: "Not implemented" }, 500);
  });

  app.openapi(CreateMappingRoute, async (c) => {
    return c.json({ error: "Not implemented" }, 500);
  });

  app.openapi(DeleteMappingRoute, async (c) => {
    return c.json({ error: "Not implemented" }, 500);
  });

  app.openapi(DownloadModelRoute, async (c) => {
    return c.json({ error: "Not implemented" }, 500);
  });

  app.openapi(HealthRoute, async (c) => {
    return c.json({ error: "Not implemented" }, 500);
  });

  app.openapi(APIInfoRoute, async (c) => {
    return c.json({ error: "Not implemented" }, 500);
  });

  return app;
}

// ============================================
// Route Types
// ============================================

export type CompletionsRoute = typeof CompletionsRoute;
export type ChatCompletionsRoute = typeof ChatCompletionsRoute;
export type ListModelsRoute = typeof ListModelsRoute;
export type ListAgentsRoute = typeof ListAgentsRoute;
export type ListMappingsRoute = typeof ListMappingsRoute;
export type CreateMappingRoute = typeof CreateMappingRoute;
export type DeleteMappingRoute = typeof DeleteMappingRoute;
export type DownloadModelRoute = typeof DownloadModelRoute;
export type HealthRoute = typeof HealthRoute;
export type APIInfoRoute = typeof APIInfoRoute;
