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
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  timestamp: Date;
}

export interface CLIConfig {
  url: string;
  apiKey?: string;
}

export interface DownloadResult {
  result?: string;
}
