/**
 * Multi-Agent Harness - Agent Directory Creator
 *
 * Creates isolated data directories for multiple agents.
 * Each agent gets:
 * - A unique data directory for agent ID storage
 * - A unique models directory (can copy from shared models if specified)
 */

import { mkdir, exists, rm, copyFile, readdir } from "fs/promises";
import { join, resolve } from "path";

export interface AgentDirConfig {
  id: number;
  baseDir: string;
  sharedModelsDir?: string;
}

export interface CreatedAgentDirs {
  agentId: number;
  dataDir: string;
  modelsDir: string;
}

/**
 * Create agent directories for a given configuration
 */
export async function createAgentDirs(
  config: AgentDirConfig
): Promise<CreatedAgentDirs> {
  const baseDir = resolve(config.baseDir);
  const agentDir = join(baseDir, String(config.id));
  const dataDir = join(agentDir, "data");
  const modelsDir = join(agentDir, "models");

  // Clean up existing directory if it exists
  if (await exists(agentDir)) {
    console.log(`⚠️  Removing existing directory for agent ${config.id}`);
    await rm(agentDir, { recursive: true, force: true });
  }

  // Create directories
  console.log(`📁 Creating directories for agent ${config.id}...`);

  await mkdir(dataDir, { recursive: true });
  await mkdir(modelsDir, { recursive: true });

  // Copy models from shared directory if specified
  if (config.sharedModelsDir) {
    const sharedPath = resolve(config.sharedModelsDir);

    if (await exists(sharedPath)) {
      console.log(`📦 Copying models from shared directory...`);

      const files = await readdir(sharedPath, { withFileTypes: true });

      for (const file of files) {
        if (file.isFile()) {
          const srcFile = join(sharedPath, file.name);
          const destFile = join(modelsDir, file.name);
          await copyFile(srcFile, destFile);
          console.log(`   Copied ${file.name}`);
        }
      }
    } else {
      console.log(`   Shared models directory does not exist, skipping copy`);
    }
  }

  return {
    agentId: config.id,
    dataDir,
    modelsDir,
  };
}

/**
 * Create directories for multiple agents
 */
export async function createMultiAgentDirs(
  agentCount: number,
  options: {
    baseDir?: string;
    sharedModelsDir?: string;
  } = {}
): Promise<CreatedAgentDirs[]> {
  const { baseDir = "./agent-data", sharedModelsDir = "./models" } = options;

  console.log(`🚀 Creating ${agentCount} agent directories in ${baseDir}`);
  if (sharedModelsDir) {
    console.log(`   Shared models dir: ${sharedModelsDir}`);
  }
  console.log("");

  const results: CreatedAgentDirs[] = [];

  for (let i = 1; i <= agentCount; i++) {
    const config: AgentDirConfig = {
      id: i,
      baseDir,
      sharedModelsDir,
    };

    const created = await createAgentDirs(config);
    results.push(created);
    console.log(
      `✅ Agent ${i}: data=${created.dataDir}, models=${created.modelsDir}`
    );
  }

  console.log("");
  console.log(`✨ Created ${agentCount} agent directories`);

  return results;
}

/**
 * Get environment variables for an agent
 */
export function getAgentEnv(
  agentDir: CreatedAgentDirs
): Record<string, string> {
  return {
    AGENT_DATA_DIR: agentDir.dataDir,
    MODELS_DIR: agentDir.modelsDir,
    AGENT_NAME: `Agent-${agentDir.agentId}`,
  };
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const agentCount = parseInt(args[0] || "2", 10);
  const baseDir = args[1] || "./agent-data";
  const sharedModelsDir = args[2] || "./models";

  createMultiAgentDirs(agentCount, { baseDir, sharedModelsDir })
    .then((dirs) => {
      console.log("\n📋 Environment variables for each agent:");
      dirs.forEach((dir) => {
        console.log(`\nAgent ${dir.agentId}:`);
        console.log(`  AGENT_DATA_DIR=${dir.dataDir}`);
        console.log(`  MODELS_DIR=${dir.modelsDir}`);
        console.log(`  AGENT_NAME=Agent-${dir.agentId}`);
      });
    })
    .catch((err) => {
      console.error("Error creating agent directories:", err);
      process.exit(1);
    });
}
