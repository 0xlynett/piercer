export interface AgentConfig {
  controllerUrl: string;
  agentSecretKey: string;
  agentName: string;
  modelsDir: string;
  agentDataDir: string;
  defaultContextSize: number;
  maxConcurrentModels: number;
  hardwarePollIntervalMs: number;
  vramBufferPercent: number;
  minFreeVramMb: number;
}

export function loadConfig(): AgentConfig {
  return {
    controllerUrl: process.env.CONTROLLER_URL || "ws://localhost:4080/ws",
    agentSecretKey: process.env.AGENT_SECRET_KEY || "dev-secret-key",
    agentName: process.env.AGENT_NAME || "Agent-1",
    modelsDir: process.env.MODELS_DIR || "./models",
    agentDataDir: process.env.AGENT_DATA_DIR || "./data",
    defaultContextSize: parseInt(process.env.DEFAULT_CONTEXT_SIZE || "4096"),
    maxConcurrentModels: parseInt(process.env.MAX_CONCURRENT_MODELS || "3"),
    hardwarePollIntervalMs: parseInt(
      process.env.HARDWARE_POLL_INTERVAL_MS || "5000"
    ),
    vramBufferPercent: parseInt(process.env.VRAM_BUFFER_PERCENT || "20"),
    minFreeVramMb: parseInt(process.env.MIN_FREE_VRAM_MB || "1024"),
  };
}
