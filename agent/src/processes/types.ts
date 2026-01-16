import type { RPC } from "@piercer/rpc";

/**
 * RPC interface exposed by the inference child process
 */
export type InferenceProcessFunctions = {
  loadModel(params: { modelPath: string }): Promise<{
    success: boolean;
    error?: string;
  }>;
  completion(params: CompletionParams): Promise<void>; // Streams via receiveChunk
  chat(params: ChatParams): Promise<void>; // Streams via receiveChunk
  unloadModel(): Promise<{ success: boolean }>;
  shutdown(): Promise<void>;
};

/**
 * RPC interface exposed by main process for child to call back
 */
export type MainProcessFunctions = {
  receiveChunk(params: { requestId: string; data: any }): Promise<void>;
  receiveComplete(params: {
    requestId: string;
    data?: any;
    usage?: TokenUsage;
  }): Promise<void>;
  receiveError(params: { requestId: string; error: any }): Promise<void>;
};

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  thought_tokens?: number;
  total_tokens: number;
}

export interface CompletionParams {
  requestId: string;
  prompt: string;
  model: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  stream?: boolean;
  logit_bias?: Record<string, number>;
  logprobs?: boolean;
}

export interface ChatParams {
  requestId: string;
  messages: Array<{
    role: string;
    content: string;
    reasoning_content?: string;
    tool_name?: string;
    tool_call_id?: string;
  }>;
  model: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: any;
  logit_bias?: Record<string, number>;
  logprobs?: boolean;
  thought_tokens?: number;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface ManagedProcess {
  modelName: string;
  process: any; // ChildProcess
  rpc: RPC<MainProcessFunctions>;
  remote: InferenceProcessFunctions;
  isGenerating: boolean;
  requestCount: number;
  startedAt: Date;
}
