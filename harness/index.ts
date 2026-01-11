/**
 * Multi-Agent Harness - Index
 *
 * Export all harness utilities for easy importing.
 */
export { MultiAgentRunner } from "./run-agents.js";
export type { RunAgentsOptions } from "./run-agents.js";
export {
  createAgentDirs,
  createMultiAgentDirs,
  getAgentEnv,
} from "./create-agent-dirs.js";
export type { AgentDirConfig, CreatedAgentDirs } from "./create-agent-dirs.js";
