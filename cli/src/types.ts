export interface ControllerInfo {
  name: string;
  version: string;
}

export interface Agent {
  id: string;
  name: string;
  loadedModels: string[];
  installedModels: string[];
  pendingRequests: number;
  status?: string;
  vram_used?: number;
  vram_total?: number;
}

export interface ModelMapping {
  public_name: string;
  internal_name: string;
}

export interface AvailableModel {
  public_name: string;
  internal_name: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  reasoning?: string;
  timestamp: Date;
  internal?: boolean;
}

export interface CLIConfig {
  url: string;
  apiKey?: string;
}

export interface DownloadResult {
  result?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<
        string,
        {
          type: string;
          description: string;
        }
      >;
      required?: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}
