/**
 * Multi-Agent Harness - Agent Directory Creator
 *
 * Creates isolated data directories for multiple agents.
 */

import { mkdir, symlink, exists, rm } from "fs/promises";
import { join, resolve } from "path";

export interface AgentDirConfig {
  id: number;
  baseDir: string;
  createModelsSymlink: boolean;
  sharedModelsDir?: string;
}

export interface CreatedAgentDirs {
  agentId: number;
  dataDir: string;
  modelsDir: string;
}

export async function createAgentDirs(
  config: AgentDirConfig
): Promise<CreatedAgentDirs> {
  const baseDir = resolve(config.baseDir);
  const agentDir = join(baseDir, String(config.id));
  const dataDir = join(agentDir, "data");
  const modelsDir = join(agentDir, "models");

  if (await exists(agentDir)) {
    console.log(`⚠️  Removing existing directory for agent ${config.id}`);
    await rm(agentDir, { recursive: true, force: true });
  }

  console.log(`📁 Creating directories for agent ${config.id}...`);

  await mkdir(dataDir, { recursive: true });

  // Create symlink to shared models if configured
  if (config.createModelsSymlink && config.sharedModelsDir) {
    const sharedPath = resolve(config.sharedModelsDir);
    const symlinkPath = join(agentDir, "models");

    await symlink(sharedPath, symlinkPath, "dir");
    console.log(`🔗 Symlinked models directory to shared location`);
  } else {
    await mkdir(modelsDir, { recursive: true });
  }

  return {
    agentId: config.id,
    dataDir,
    modelsDir,
  };
}

export async function createMultiAgentDirs(
  agentCount: number,
  options: {
    baseDir?: string;
    sharedModels?: boolean;
    sharedModelsDir?: string;
  } = {}
): Promise<CreatedAgentDirs[]> {
  const {
    baseDir = "./agent-data",
    sharedModels = true,
    sharedModelsDir = "./models",
  } = options;

  console.log(`🚀 Creating ${agentCount} agent directories in ${baseDir}`);
  console.log(`   Shared models: ${sharedModels ? "yes" : "no"}`);
  console.log("");

  const results: CreatedAgentDirs[] = [];

  for (let i = 1; i <= agentCount; i++) {
    const config: AgentDirConfig = {
      id: i,
      baseDir,
      createModelsSymlink: sharedModels,
      sharedModelsDir: sharedModelsDir,
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

export function getAgentEnv(
  agentDir: CreatedAgentDirs
): Record<string, string> {
  return {
    AGENT_DATA_DIR: agentDir.dataDir,
    MODELS_DIR: agentDir.modelsDir,
    AGENT_NAME: `Agent-${agentDir.agentId}`,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const agentCount = parseInt(args[0] || "2", 10);
  const baseDir = args[1] || "./agent-data";

  createMultiAgentDirs(agentCount, { baseDir })
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
