import type { RPC } from "@piercer/rpc";

/**
 * RPC interface exposed by the inference child process
 */
export type InferenceProcessFunctions = {
  loadModel(params: { modelPath: string; contextSize: number }): Promise<{
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
  receiveComplete(params: { requestId: string; data?: any }): Promise<void>;
  receiveError(params: { requestId: string; error: any }): Promise<void>;
};

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
}

export interface ChatParams {
  requestId: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  stream?: boolean;
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
