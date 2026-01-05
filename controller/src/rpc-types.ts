export interface CompletionParams {
  prompt: string;
  stop?: string[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  [key: string]: any;
}

export interface ChatParams {
  messages: Array<{ role: string; content: string }>;
  stop?: string[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  [key: string]: any;
}

export interface AgentFunctions {
  completion(params: CompletionParams): Promise<any>;
  chat(params: ChatParams): Promise<any>;
  listModels(): Promise<{ models: string[] }>;
  currentModels(): Promise<{ models: string[] }>;
  startModel(params: { model: string }): Promise<{ models: string[] }>;
  downloadModel(params: { model_url: string; filename: string }): Promise<any>;
  status(): Promise<{ status: string }>;
  [key: string]: Function;
}

export interface ControllerFunctions {
  error(params: { error: any; agentId?: string; context?: any }): void;
  receiveCompletion(params: {
    agentId: string;
    requestId: string;
    data: any;
  }): void;
  [key: string]: Function;
}
