import { z } from "@hono/zod-openapi";

// ============================================
// Common Schemas
// ============================================

/**
 * Token usage information
 */
export const TokenUsageSchema = z.object({
  prompt_tokens: z.number().openapi({ description: "Number of tokens in the prompt" }),
  completion_tokens: z.number().openapi({ description: "Number of tokens in the completion" }),
  total_tokens: z.number().openapi({ description: "Total number of tokens" }),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * Error response schema
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    message: z.string().openapi({ description: "Error message" }),
    type: z.string().openapi({ description: "Error type" }),
    code: z.string().optional().openapi({ description: "Error code" }),
    param: z.string().optional().openapi({ description: "Parameter that caused the error" }),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ============================================
// Completion API Schemas
// ============================================

/**
 * Completion logprobs schema
 */
export const CompletionLogprobsSchema = z.object({
  tokens: z.array(z.string()).openapi({ description: "Tokens" }),
  token_logprobs: z.array(z.number()).openapi({ description: "Log probabilities of tokens" }),
  top_logprobs: z.array(z.record(z.number())).openapi({ description: "Top log probabilities" }),
  text_offset: z.array(z.number()).openapi({ description: "Text offsets" }),
});

export type CompletionLogprobs = z.infer<typeof CompletionLogprobsSchema>;

/**
 * Completion choice schema
 */
export const CompletionChoiceSchema = z.object({
  index: z.number().openapi({ description: "Choice index" }),
  text: z.string().openapi({ description: "Generated text" }),
  logprobs: z.nullable(CompletionLogprobsSchema).openapi({ description: "Log probabilities" }),
  finish_reason: z.string().openapi({ description: "Reason for finishing" }),
});

export type CompletionChoice = z.infer<typeof CompletionChoiceSchema>;

/**
 * Completion request schema
 */
export const CompletionRequestSchema = z.object({
  model: z.string().openapi({ description: "Model to use for completion" }),
  prompt: z.union([z.string(), z.array(z.string())]).openapi({ description: "Prompt to complete" }),
  max_tokens: z.number().optional().openapi({ description: "Maximum tokens to generate", minimum: 0 }),
  temperature: z.number().optional().openapi({ description: "Sampling temperature", minimum: 0, maximum: 2 }),
  top_p: z.number().optional().openapi({ description: "Top-p sampling", minimum: 0, maximum: 1 }),
  n: z.number().optional().openapi({ description: "Number of completions", minimum: 1, maximum: 10 }),
  stream: z.boolean().optional().openapi({ description: "Stream results" }),
  logprobs: z.boolean().optional().openapi({ description: "Return log probabilities" }),
  echo: z.boolean().optional().openapi({ description: "Echo prompt" }),
  stop: z.union([z.string(), z.array(z.string())]).optional().openapi({ description: "Stop sequences" }),
  presence_penalty: z.number().optional().openapi({ description: "Presence penalty", minimum: -2, maximum: 2 }),
  frequency_penalty: z.number().optional().openapi({ description: "Frequency penalty", minimum: -2, maximum: 2 }),
  best_of: z.number().optional().openapi({ description: "Generate best_of completions" }),
  logit_bias: z.record(z.number()).optional().openapi({ description: "Logit bias for tokens" }),
  user: z.string().optional().openapi({ description: "User identifier" }),
});

export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;

/**
 * Completion response schema
 */
export const CompletionResponseSchema = z.object({
  id: z.string().openapi({ description: "Completion ID" }),
  object: z.literal("text_completion").openapi({ description: "Object type" }),
  created: z.number().openapi({ description: "Creation timestamp" }),
  model: z.string().openapi({ description: "Model used" }),
  choices: z.array(CompletionChoiceSchema).openapi({ description: "Completion choices" }),
  usage: TokenUsageSchema.openapi({ description: "Token usage" }),
});

export type CompletionResponse = z.infer<typeof CompletionResponseSchema>;

// ============================================
// Chat Completion API Schemas
// ============================================

/**
 * Chat message schema
 */
export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]).openapi({ description: "Message role" }),
  content: z.string().openapi({ description: "Message content" }),
  name: z.string().optional().openapi({ description: "Message author name" }),
  tool_calls: z.array(z.object({
    id: z.string().openapi({ description: "Tool call ID" }),
    type: z.literal("function").openapi({ description: "Tool call type" }),
    function: z.object({
      name: z.string().openapi({ description: "Function name" }),
      arguments: z.string().openapi({ description: "Function arguments" }),
    }),
  })).optional().openapi({ description: "Tool calls" }),
  tool_call_id: z.string().optional().openapi({ description: "Tool call response ID" }),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * Logprob result schema
 */
export const LogprobResultSchema = z.object({
  token: z.string().openapi({ description: "Token" }),
  logprob: z.number().openapi({ description: "Log probability" }),
  bytes: z.array(z.number()).optional().openapi({ description: "Token bytes" }),
  top_logprobs: z.array(z.object({
    token: z.string(),
    logprob: z.number(),
    bytes: z.array(z.number()).optional(),
  })).openapi({ description: "Top log probabilities" }),
});

export type LogprobResult = z.infer<typeof LogprobResultSchema>;

/**
 * Chat logprobs schema
 */
export const ChatLogprobsSchema = z.object({
  content: z.array(LogprobResultSchema).openapi({ description: "Content logprobs" }),
});

export type ChatLogprobs = z.infer<typeof ChatLogprobsSchema>;

/**
 * Chat completion choice schema
 */
export const ChatCompletionChoiceSchema = z.object({
  index: z.number().openapi({ description: "Choice index" }),
  message: ChatMessageSchema.openapi({ description: "Response message" }),
  logprobs: z.nullable(ChatLogprobsSchema).openapi({ description: "Log probabilities" }),
  finish_reason: z.string().openapi({ description: "Reason for finishing" }),
});

export type ChatCompletionChoice = z.infer<typeof ChatCompletionChoiceSchema>;

/**
 * Chat completion request schema
 */
export const ChatCompletionRequestSchema = z.object({
  model: z.string().openapi({ description: "Model to use for chat completion" }),
  messages: z.array(ChatMessageSchema).openapi({ description: "Conversation messages" }),
  max_tokens: z.number().optional().openapi({ description: "Maximum tokens to generate", minimum: 0 }),
  temperature: z.number().optional().openapi({ description: "Sampling temperature", minimum: 0, maximum: 2 }),
  top_p: z.number().optional().openapi({ description: "Top-p sampling", minimum: 0, maximum: 1 }),
  n: z.number().optional().openapi({ description: "Number of completions", minimum: 1, maximum: 10 }),
  stream: z.boolean().optional().openapi({ description: "Stream results" }),
  stop: z.union([z.string(), z.array(z.string())]).optional().openapi({ description: "Stop sequences" }),
  presence_penalty: z.number().optional().openapi({ description: "Presence penalty", minimum: -2, maximum: 2 }),
  frequency_penalty: z.number().optional().openapi({ description: "Frequency penalty", minimum: -2, maximum: 2 }),
  logprobs: z.boolean().optional().openapi({ description: "Return log probabilities" }),
  top_logprobs: z.number().optional().openapi({ description: "Number of top logprobs" }),
  user: z.string().optional().openapi({ description: "User identifier" }),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

/**
 * Chat completion response schema
 */
export const ChatCompletionResponseSchema = z.object({
  id: z.string().openapi({ description: "Completion ID" }),
  object: z.literal("chat.completion").openapi({ description: "Object type" }),
  created: z.number().openapi({ description: "Creation timestamp" }),
  model: z.string().openapi({ description: "Model used" }),
  choices: z.array(ChatCompletionChoiceSchema).openapi({ description: "Completion choices" }),
  usage: TokenUsageSchema.openapi({ description: "Token usage" }),
});

export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

// ============================================
// Models API Schemas
// ============================================

/**
 * Model info schema
 */
export const ModelInfoSchema = z.object({
  id: z.string().openapi({ description: "Model ID" }),
  object: z.literal("model").openapi({ description: "Object type" }),
  created: z.number().openapi({ description: "Creation timestamp" }),
  owned_by: z.string().openapi({ description: "Model owner" }),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;

/**
 * Models list response schema
 */
export const ModelsResponseSchema = z.object({
  object: z.literal("list").openapi({ description: "Object type" }),
  data: z.array(ModelInfoSchema).openapi({ description: "List of models" }),
});

export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

// ============================================
// Management API Schemas
// ============================================

/**
 * Agent info schema
 */
export const AgentInfoSchema = z.object({
  id: z.string().openapi({ description: "Agent unique identifier" }),
  name: z.string().openapi({ description: "Agent human-readable name" }),
  status: z.enum(["connected", "disconnected", "loading_model", "processing"]).openapi({ description: "Agent status" }),
  loaded_models: z.array(z.string()).openapi({ description: "Models currently loaded" }),
  pending_requests: z.number().openapi({ description: "Number of pending requests" }),
  last_seen: z.string().openapi({ description: "Last seen timestamp" }),
  vram_total: z.number().optional().openapi({ description: "Total VRAM in bytes" }),
  vram_used: z.number().optional().openapi({ description: "Used VRAM in bytes" }),
});

export type AgentInfo = z.infer<typeof AgentInfoSchema>;

/**
 * Model mapping schema
 */
export const ModelMappingSchema = z.object({
  id: z.number().openapi({ description: "Mapping ID" }),
  public_name: z.string().openapi({ description: "Public model name" }),
  filename: z.string().openapi({ description: "Internal filename" }),
  created_at: z.number().openapi({ description: "Creation timestamp" }),
});

export type ModelMapping = z.infer<typeof ModelMappingSchema>;

/**
 * Create model mapping request schema
 */
export const CreateMappingRequestSchema = z.object({
  public_name: z.string().openapi({ description: "Public model name" }),
  filename: z.string().openapi({ description: "Internal filename" }),
});

export type CreateMappingRequest = z.infer<typeof CreateMappingRequestSchema>;

/**
 * Create mapping response schema
 */
export const CreateMappingResponseSchema = z.object({
  success: z.boolean().openapi({ description: "Success status" }),
});

export type CreateMappingResponse = z.infer<typeof CreateMappingResponseSchema>;

/**
 * Download model request schema
 */
export const DownloadModelRequestSchema = z.object({
  model_url: z.string().openapi({ description: "URL to download model from" }),
  filename: z.string().openapi({ description: "Filename to save as" }),
});

export type DownloadModelRequest = z.infer<typeof DownloadModelRequestSchema>;

/**
 * Download model response schema
 */
export const DownloadModelResponseSchema = z.object({
  success: z.boolean().openapi({ description: "Success status" }),
  result: z.string().optional().openapi({ description: "Download result" }),
});

export type DownloadModelResponse = z.infer<typeof DownloadModelResponseSchema>;

// ============================================
// Health Check Schema
// ============================================

/**
 * Health check response schema
 */
export const HealthResponseSchema = z.object({
  status: z.literal("healthy").openapi({ description: "Health status" }),
  timestamp: z.string().openapi({ description: "Current timestamp" }),
  uptime: z.number().openapi({ description: "Server uptime in seconds" }),
  connected_agents: z.number().openapi({ description: "Number of connected agents" }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * API info response schema
 */
export const APIInfoResponseSchema = z.object({
  name: z.string().openapi({ description: "API name" }),
  version: z.string().openapi({ description: "API version" }),
  description: z.string().openapi({ description: "API description" }),
  endpoints: z.record(z.string()).openapi({ description: "Available endpoints" }),
  connected_agents: z.number().openapi({ description: "Number of connected agents" }),
});

export type APIInfoResponse = z.infer<typeof APIInfoResponseSchema>;
