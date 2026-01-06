import type { Context, Next } from "hono";
import type { Db } from "../services/db";
import type { Logger } from "../services/logger";
import type { RoutingService } from "../services/routing";
import type { MappingsService } from "../services/mappings";
import type { AgentManager } from "../services/agents";
import type { AgentRPCService } from "../services/agent-rpc";
import { randomUUID } from "crypto";

// ============================================
// Type Definitions
// ============================================

// Completion API Types
export interface CompletionRequest {
  model: string;
  prompt: string | string[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  logprobs?: boolean;
  echo?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  best_of?: number;
  logit_bias?: Record<string, number>;
  user?: string;
}

export interface CompletionResponse {
  id: string;
  object: "text_completion";
  created: number;
  model: string;
  choices: CompletionChoice[];
  usage: TokenUsage;
}

export interface CompletionChoice {
  index: number;
  text: string;
  logprobs: CompletionLogprobs | null;
  finish_reason: string;
}

export interface CompletionLogprobs {
  tokens: string[];
  token_logprobs: number[];
  top_logprobs: Record<string, number>[];
  text_offset: number[];
}

// Chat Completion API Types
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  logprobs?: boolean;
  top_logprobs?: number;
  user?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: TokenUsage;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  logprobs: ChatLogprobs | null;
  finish_reason: string;
}

export interface ChatLogprobs {
  content: LogprobResult[];
}

export interface LogprobResult {
  token: string;
  logprob: number;
  bytes?: number[];
  top_logprobs: LogprobTop[];
}

export interface LogprobTop {
  token: string;
  logprob: number;
  bytes?: number[];
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// Models API Types
export interface ModelsResponse {
  object: "list";
  data: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

// ============================================
// Error Types
// ============================================

export interface OpenAIError {
  code: string;
  message: string;
  param?: string;
  type: string;
}

export class OpenAIAPIError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly type: string;
  public readonly param?: string;

  constructor(
    message: string,
    code: string,
    type: string,
    status: number,
    param?: string
  ) {
    super(message);
    this.name = "OpenAIAPIError";
    this.code = code;
    this.type = type;
    this.status = status;
    this.param = param;
  }
}

// ============================================
// OpenAI API Handler
// ============================================

export interface OpenAIAPIConfig {
  db: Db;
  logger: Logger;
  routingService: RoutingService;
  mappingsService: MappingsService;
  agentManager: AgentManager;
  agentRPCService: AgentRPCService;
  apiKey?: string;
  rateLimitMax?: number;
}

export class OpenAIAPIHandler {
  private db: Db;
  private logger: Logger;
  private routingService: RoutingService;
  private mappingsService: MappingsService;
  private agentManager: AgentManager;
  private agentRPCService: AgentRPCService;
  private apiKey?: string;
  private rateLimitMax: number;
  private requestCounts: Map<string, number[]> = new Map();

  constructor(config: OpenAIAPIConfig) {
    this.db = config.db;
    this.logger = config.logger;
    this.routingService = config.routingService;
    this.mappingsService = config.mappingsService;
    this.agentManager = config.agentManager;
    this.agentRPCService = config.agentRPCService;
    this.apiKey = config.apiKey;
    this.rateLimitMax = config.rateLimitMax || 100;
  }

  // ========================================
  // Middleware
  // ========================================

  /**
   * API key validation middleware
   */
  validateAPIKey(): (c: Context, next: Next) => Promise<Response | void> {
    return async (c: Context, next: Next) => {
      // Skip if no API key is configured
      if (!this.apiKey) {
        return next();
      }

      const authHeader = c.req.header("Authorization");
      if (!authHeader) {
        throw new OpenAIAPIError(
          "Missing API key",
          "missing_api_key",
          "authentication_error",
          401
        );
      }

      const token = authHeader.replace("Bearer ", "");
      if (token !== this.apiKey) {
        throw new OpenAIAPIError(
          "Invalid API key",
          "invalid_api_key",
          "authentication_error",
          401
        );
      }

      return next();
    };
  }

  /**
   * Rate limiting middleware
   */
  rateLimit(): (c: Context, next: Next) => Promise<Response | void> {
    return async (c: Context, next: Next) => {
      const ip =
        c.req.header("X-Forwarded-For") ||
        c.req.header("CF-Connecting-IP") ||
        "unknown";
      const now = Date.now();
      const windowMs = 60000; // 1 minute window

      const timestamps = this.requestCounts.get(ip) || [];
      const validTimestamps = timestamps.filter((t) => now - t < windowMs);

      if (validTimestamps.length >= this.rateLimitMax) {
        throw new OpenAIAPIError(
          "Rate limit exceeded",
          "rate_limit_exceeded",
          "rate_limit_error",
          429
        );
      }

      validTimestamps.push(now);
      this.requestCounts.set(ip, validTimestamps);

      return next();
    };
  }

  /**
   * Request ID middleware
   */
  addRequestId(): (c: Context, next: Next) => Promise<void> {
    return async (c: Context, next: Next) => {
      const requestId = c.req.header("X-Request-ID") || randomUUID();
      c.set("requestId", requestId);
      c.header("X-Request-ID", requestId);
      await next();
    };
  }

  // ========================================
  // Completions API (/v1/completions)
  // ========================================

  /**
   * Handle legacy completions API requests
   */
  async handleCompletions(c: Context): Promise<Response> {
    const requestId = c.get("requestId") as string;
    const startTime = Date.now();

    try {
      // Parse and validate request body
      const body = await c.req.json();
      const request = this.parseCompletionRequest(body);

      // Log request
      this.logger.requestReceived(requestId, "completion", request.model, {
        stream: request.stream,
        temperature: request.temperature,
      });

      // Translate model name from public to internal
      const internalModel = this.mappingsService.publicToInternal(
        request.model
      );
      if (!internalModel) {
        throw new OpenAIAPIError(
          `Model '${request.model}' not found`,
          "model_not_found",
          "invalid_request_error",
          400
        );
      }

      // Select agent via routing service
      const routingResult = await this.routingService.selectAgent({
        model: internalModel,
        requestType: "completion",
        requestId,
      });

      if (!routingResult) {
        throw new OpenAIAPIError(
          "No agents available",
          "no_available_agents",
          "service_unavailable_error",
          503
        );
      }

      // Check if model needs to be started
      const chatLoadedModels = this.agentManager.getLoadedModels(
        routingResult.agent.id
      );
      if (!chatLoadedModels.includes(internalModel)) {
        this.logger.info(
          `Model ${internalModel} not loaded on agent ${routingResult.agent.id}. Starting model...`,
          {
            requestId,
            agentId: routingResult.agent.id,
            model: internalModel,
          }
        );

        await this.agentRPCService.startModel({
          agentId: routingResult.agent.id,
          model: internalModel,
        });
      }

      // Create pending request in database
      const pendingRequestId = this.db.addPendingRequest(
        routingResult.agent.id,
        "completion",
        internalModel
      );

      // Handle streaming vs non-streaming
      if (request.stream) {
        return this.handleStreamingCompletion(
          c,
          request,
          routingResult.agent.id,
          requestId
        );
      }

      // Non-streaming completion
      const response = await this.executeCompletion(
        routingResult.agent.id,
        request,
        requestId
      );

      // Update pending request status
      this.db.updatePendingRequestStatus(pendingRequestId, "completed");

      // Log completion
      const duration = Date.now() - startTime;
      this.logger.requestCompleted(requestId, duration, {
        model: request.model,
        tokens: response.usage.total_tokens,
      });

      return c.json(response, 200);
    } catch (error) {
      return this.handleError(c, error, requestId);
    }
  }

  /**
   * Parse and validate completion request
   */
  private parseCompletionRequest(body: any): CompletionRequest {
    if (!body.model) {
      throw new OpenAIAPIError(
        "Missing required parameter: 'model'",
        "missing_required_parameter",
        "invalid_request_error",
        400,
        "model"
      );
    }

    if (!body.prompt && body.prompt !== 0) {
      throw new OpenAIAPIError(
        "Missing required parameter: 'prompt'",
        "missing_required_parameter",
        "invalid_request_error",
        400,
        "prompt"
      );
    }

    // Validate numeric parameters
    if (
      body.max_tokens !== undefined &&
      (body.max_tokens < 0 || !Number.isInteger(body.max_tokens))
    ) {
      throw new OpenAIAPIError(
        "'max_tokens' must be a positive integer",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "max_tokens"
      );
    }

    if (
      body.temperature !== undefined &&
      (body.temperature < 0 || body.temperature > 2)
    ) {
      throw new OpenAIAPIError(
        "'temperature' must be between 0 and 2",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "temperature"
      );
    }

    if (body.top_p !== undefined && (body.top_p < 0 || body.top_p > 1)) {
      throw new OpenAIAPIError(
        "'top_p' must be between 0 and 1",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "top_p"
      );
    }

    if (
      body.presence_penalty !== undefined &&
      (body.presence_penalty < -2 || body.presence_penalty > 2)
    ) {
      throw new OpenAIAPIError(
        "'presence_penalty' must be between -2 and 2",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "presence_penalty"
      );
    }

    if (
      body.frequency_penalty !== undefined &&
      (body.frequency_penalty < -2 || body.frequency_penalty > 2)
    ) {
      throw new OpenAIAPIError(
        "'frequency_penalty' must be between -2 and 2",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "frequency_penalty"
      );
    }

    return {
      model: body.model,
      prompt: body.prompt,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      top_p: body.top_p,
      n: body.n,
      stream: body.stream,
      logprobs: body.logprobs,
      echo: body.echo,
      stop: body.stop,
      presence_penalty: body.presence_penalty,
      frequency_penalty: body.frequency_penalty,
      best_of: body.best_of,
      logit_bias: body.logit_bias,
      user: body.user,
    };
  }

  /**
   * Handle streaming completion
   */
  private async handleStreamingCompletion(
    c: Context,
    request: CompletionRequest,
    agentId: string,
    requestId: string
  ): Promise<Response> {
    const stream = new ReadableStream({
      start: async (controller) => {
        try {
          this.agentManager.registerStream(requestId, controller);

          await this.agentRPCService.completion({
            ...request,
            agentId,
            requestId,
          });
        } catch (error) {
          const errorChunk = {
            error: {
              message: error instanceof Error ? error.message : "Unknown error",
              type: "server_error",
            },
          };
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
          );
          controller.error(error);
          this.agentManager.removeStream(requestId);
        }
      },
      cancel: () => {
        this.agentManager.removeStream(requestId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Request-ID": requestId,
      },
    });
  }

  /**
   * Execute completion on agent
   * BUG LIES HERE
   */
  private async executeCompletion(
    agentId: string,
    request: CompletionRequest,
    requestId: string
  ): Promise<CompletionResponse> {
    let response: CompletionResponse | null = null;
    let fullText = "";

    const stream = new ReadableStream({
      start: async (controller) => {
        try {
          this.agentManager.registerStream(requestId, controller);
          await this.agentRPCService.completion({
            ...request,
            agentId,
            requestId,
            stream: false, // Ensure agent knows we want non-streaming if possible, but we handle stream anyway
          });
        } catch (error) {
          controller.error(error);
          this.agentManager.removeStream(requestId);
        }
      },
      cancel: () => {
        this.agentManager.removeStream(requestId);
      },
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const chunk = JSON.parse(data);
              if (!response) {
                // Initialize response from first chunk
                response = {
                  id: chunk.id,
                  object: "text_completion",
                  created: chunk.created,
                  model: chunk.model,
                  choices: [
                    {
                      index: 0,
                      text: "",
                      logprobs: null,
                      finish_reason: "stop",
                    },
                  ],
                  usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                  },
                };
              }

              if (chunk.choices && chunk.choices[0]) {
                fullText += chunk.choices[0].text || "";
                if (
                  chunk.choices[0].finish_reason &&
                  response &&
                  response.choices[0]
                ) {
                  response.choices[0].finish_reason =
                    chunk.choices[0].finish_reason;
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!response) {
      throw new Error("No response received from agent");
    }

    if (response.choices[0]) {
      response.choices[0].text = fullText;
    }
    // TODO: Calculate usage if not provided

    return response;
  }

  // ========================================
  // Chat Completions API (/v1/chat/completions)
  // ========================================

  /**
   * Handle chat completions API requests
   */
  async handleChatCompletions(c: Context): Promise<Response> {
    const requestId = c.get("requestId") as string;
    const startTime = Date.now();

    try {
      // Parse and validate request body
      const body = await c.req.json();
      const request = this.parseChatCompletionRequest(body);

      // Log request
      this.logger.requestReceived(requestId, "chat", request.model, {
        stream: request.stream,
        temperature: request.temperature,
        messageCount: request.messages.length,
      });

      // Translate model name from public to internal
      const internalModel = this.mappingsService.publicToInternal(
        request.model
      );
      if (!internalModel) {
        throw new OpenAIAPIError(
          `Model '${request.model}' not found`,
          "model_not_found",
          "invalid_request_error",
          400
        );
      }

      // Select agent via routing service
      const routingResult = await this.routingService.selectAgent({
        model: internalModel,
        requestType: "chat",
        requestId,
      });

      if (!routingResult) {
        throw new OpenAIAPIError(
          "No agents available",
          "no_available_agents",
          "service_unavailable_error",
          503
        );
      }

      // Check if model needs to be started
      const loadedModels = this.agentManager.getLoadedModels(
        routingResult.agent.id
      );
      if (!loadedModels.includes(internalModel)) {
        this.logger.info(
          `Model ${internalModel} not loaded on agent ${routingResult.agent.id}. Starting model...`,
          {
            requestId,
            agentId: routingResult.agent.id,
            model: internalModel,
          }
        );

        try {
          await this.agentRPCService.startModel({
            agentId: routingResult.agent.id,
            model: internalModel,
          });
          console.log("DEBUG after starting model");
        } catch (error) {
          console.error("Error starting model", error);
        }
      }

      // Create pending request in database
      const pendingRequestId = this.db.addPendingRequest(
        routingResult.agent.id,
        "chat",
        internalModel
      );
      console.log("DEBUG after adding pending request");

      // Handle streaming vs non-streaming
      if (request.stream) {
        return this.handleStreamingChatCompletion(
          c,
          request,
          routingResult.agent.id,
          requestId
        );
      }

      console.log("DEBUG before execute chat completion");

      // Non-streaming chat completion
      const response = await this.executeChatCompletion(
        routingResult.agent.id,
        request,
        requestId
      );

      // Update pending request status
      this.db.updatePendingRequestStatus(pendingRequestId, "completed");

      // Log completion
      const duration = Date.now() - startTime;
      this.logger.requestCompleted(requestId, duration, {
        model: request.model,
        tokens: response.usage.total_tokens,
      });

      return c.json(response, 200);
    } catch (error) {
      return this.handleError(c, error, requestId);
    }
  }

  /**
   * Parse and validate chat completion request
   */
  private parseChatCompletionRequest(body: any): ChatCompletionRequest {
    if (!body.model) {
      throw new OpenAIAPIError(
        "Missing required parameter: 'model'",
        "missing_required_parameter",
        "invalid_request_error",
        400,
        "model"
      );
    }

    if (
      !body.messages ||
      !Array.isArray(body.messages) ||
      body.messages.length === 0
    ) {
      throw new OpenAIAPIError(
        "Missing required parameter: 'messages'",
        "missing_required_parameter",
        "invalid_request_error",
        400,
        "messages"
      );
    }

    // Validate messages
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (!msg.role) {
        throw new OpenAIAPIError(
          `Missing 'role' in messages[${i}]`,
          "missing_required_parameter",
          "invalid_request_error",
          400,
          "messages[].role"
        );
      }
      if (!msg.content && !msg.tool_calls) {
        throw new OpenAIAPIError(
          `Missing 'content' or 'tool_calls' in messages[${i}]`,
          "missing_required_parameter",
          "invalid_request_error",
          400,
          "messages[].content"
        );
      }
      const validRoles = ["system", "user", "assistant", "tool"];
      if (!validRoles.includes(msg.role)) {
        throw new OpenAIAPIError(
          `Invalid role '${
            msg.role
          }' in messages[${i}]. Must be one of: ${validRoles.join(", ")}`,
          "invalid_request_error",
          "invalid_request_error",
          400,
          "messages[].role"
        );
      }
    }

    // Validate numeric parameters
    if (
      body.max_tokens !== undefined &&
      (body.max_tokens < 0 || !Number.isInteger(body.max_tokens))
    ) {
      throw new OpenAIAPIError(
        "'max_tokens' must be a positive integer",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "max_tokens"
      );
    }

    if (
      body.temperature !== undefined &&
      (body.temperature < 0 || body.temperature > 2)
    ) {
      throw new OpenAIAPIError(
        "'temperature' must be between 0 and 2",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "temperature"
      );
    }

    if (body.top_p !== undefined && (body.top_p < 0 || body.top_p > 1)) {
      throw new OpenAIAPIError(
        "'top_p' must be between 0 and 1",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "top_p"
      );
    }

    if (
      body.presence_penalty !== undefined &&
      (body.presence_penalty < -2 || body.presence_penalty > 2)
    ) {
      throw new OpenAIAPIError(
        "'presence_penalty' must be between -2 and 2",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "presence_penalty"
      );
    }

    if (
      body.frequency_penalty !== undefined &&
      (body.frequency_penalty < -2 || body.frequency_penalty > 2)
    ) {
      throw new OpenAIAPIError(
        "'frequency_penalty' must be between -2 and 2",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "frequency_penalty"
      );
    }

    if (
      body.n !== undefined &&
      (body.n < 1 || body.n > 10 || !Number.isInteger(body.n))
    ) {
      throw new OpenAIAPIError(
        "'n' must be an integer between 1 and 10",
        "invalid_parameter_value",
        "invalid_request_error",
        400,
        "n"
      );
    }

    return {
      model: body.model,
      messages: body.messages,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      top_p: body.top_p,
      n: body.n,
      stream: body.stream,
      stop: body.stop,
      presence_penalty: body.presence_penalty,
      frequency_penalty: body.frequency_penalty,
      logprobs: body.logprobs,
      top_logprobs: body.top_logprobs,
      user: body.user,
    };
  }

  /**
   * Handle streaming chat completion
   */
  private async handleStreamingChatCompletion(
    c: Context,
    request: ChatCompletionRequest,
    agentId: string,
    requestId: string
  ): Promise<Response> {
    const stream = new ReadableStream({
      start: async (controller) => {
        console.log("Stream started for requestId:", requestId);
        try {
          this.agentManager.registerStream(requestId, controller);

          console.log("Calling agentRPCService.chat");
          await this.agentRPCService.chat({
            ...request,
            agentId,
            requestId,
          });
          console.log("agentRPCService.chat called successfully");
        } catch (error) {
          const errorChunk = {
            error: {
              message: error instanceof Error ? error.message : "Unknown error",
              type: "server_error",
            },
          };
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
          );
          controller.error(error);
          this.agentManager.removeStream(requestId);
        }
      },
      cancel: () => {
        this.agentManager.removeStream(requestId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Request-ID": requestId,
      },
    });
  }

  /**
   * Execute chat completion on agent
   */
  private async executeChatCompletion(
    agentId: string,
    request: ChatCompletionRequest,
    requestId: string
  ): Promise<ChatCompletionResponse> {
    let response: ChatCompletionResponse | null = null;
    let fullContent = "";

    const stream = new ReadableStream({
      start: async (controller) => {
        try {
          this.agentManager.registerStream(requestId, controller);
          this.logger.info(`Forwarding request to agent`, {
            requestId,
            agentId,
          });
          await this.agentRPCService.chat({
            ...request,
            agentId,
            requestId,
            stream: false,
          });
          this.logger.info(`Request forwarded to agent`, {
            requestId,
            agentId,
          });
        } catch (error) {
          controller.error(error);
          this.agentManager.removeStream(requestId);
        }
      },
      cancel: () => {
        this.agentManager.removeStream(requestId);
      },
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const chunk = JSON.parse(data);
              if (!response) {
                response = {
                  id: chunk.id,
                  object: "chat.completion",
                  created: chunk.created,
                  model: chunk.model,
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: "assistant",
                        content: "",
                      },
                      logprobs: null,
                      finish_reason: "stop",
                    },
                  ],
                  usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                  },
                };
              }

              if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
                if (chunk.choices[0].delta.content) {
                  fullContent += chunk.choices[0].delta.content;
                }
                if (
                  chunk.choices[0].finish_reason &&
                  response &&
                  response.choices[0]
                ) {
                  response.choices[0].finish_reason =
                    chunk.choices[0].finish_reason;
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!response) {
      throw new Error("No response received from agent");
    }

    if (response.choices[0]) {
      response.choices[0].message.content = fullContent;
    }

    return response;
  }

  // ========================================
  // Models API (/v1/models)
  // ========================================

  /**
   * Handle models API requests
   */
  async handleModels(c: Context): Promise<Response> {
    const requestId = c.get("requestId") as string;

    try {
      const mappings = this.mappingsService.getAllMappings();

      const modelsResponse: ModelsResponse = {
        object: "list",
        data: mappings.map((mapping) => ({
          id: mapping.public_name,
          object: "model",
          created: mapping.created_at,
          owned_by: "piercer",
        })),
      };

      return c.json(modelsResponse, 200);
    } catch (error) {
      return this.handleError(c, error, requestId);
    }
  }

  // ========================================
  // Error Handling
  // ========================================

  /**
   * Handle errors and format as OpenAI-compatible responses
   */
  private handleError(c: Context, error: unknown, requestId: string): Response {
    if (error instanceof OpenAIAPIError) {
      this.logger.requestFailed(requestId, error as Error, {
        code: error.code,
        type: error.type,
      });

      return c.json(
        {
          error: {
            message: error.message,
            type: error.type,
            code: error.code,
            param: error.param,
          },
        },
        error.status as 400 | 401 | 403 | 404 | 429 | 500 | 503
      );
    }

    const err = error as Error;
    this.logger.requestFailed(requestId, err, {
      path: c.req.path,
    });

    return c.json(
      {
        error: {
          message: err.message || "An internal error occurred",
          type: "server_error",
          code: "internal_error",
        },
      },
      500
    );
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Estimate token count for a string (simple approximation)
   */
  private estimateTokenCount(text: string): number {
    // Rough approximation: 4 characters per token on average
    return Math.ceil(text.length / 4);
  }
}

// ============================================
// Hono Route Bindings
// ============================================

/**
 * Create Hono route bindings for OpenAI API endpoints
 */
export function createOpenAIRoutes(handler: OpenAIAPIHandler): {
  completions: (c: Context) => Promise<Response>;
  chatCompletions: (c: Context) => Promise<Response>;
  models: (c: Context) => Promise<Response>;
} {
  return {
    completions: (c: Context) => handler.handleCompletions(c),
    chatCompletions: (c: Context) => handler.handleChatCompletions(c),
    models: (c: Context) => handler.handleModels(c),
  };
}
