/**
 * Multi-Agent Harness - Agent Runner
 * 
 * Spawns multiple isolated agent processes with different configurations.
 * Each agent gets:
 * - Isolated data directory (for agent ID)
 * - Isolated or shared models directory
 * - Unique agent name
 */

import { spawn, ChildProcess } from "child_process";
import { join, resolve } from "path";
import * as readline from "readline";

export interface AgentProcess {
  id: number;
  process: ChildProcess;
  dataDir: string;
  modelsDir: string;
  name: string;
  startupPromise: Promise<void>;
}

export interface RunAgentsOptions {
  agentCount: number;
  baseDir?: string;
  sharedModels?: boolean;
  controllerUrl?: string;
  agentSecretKey?: string;
  quiet?: boolean;
}

interface PendingAgent {
  id: number;
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Run multiple agents as child processes
 */
export class MultiAgentRunner {
  private agents: Map<number, AgentProcess> = new Map();
  private pendingAgents: PendingAgent[] = [];
  private startupTimeout = 30000; // 30 seconds per agent
  private isShuttingDown = false;

  constructor(private options: RunAgentsOptions) {}

  /**
   * Start all agents
   */
  async start(): Promise<void> {
    const {
      agentCount,
      baseDir = "./agent-data",
      controllerUrl = "ws://localhost:4080/ws",
      agentSecretKey = "dev-secret-key",
      quiet = false,
    } = this.options;

    console.log(`🚀 Starting ${agentCount} agents...`);
    console.log(`   Controller URL: ${controllerUrl}`);
    console.log(`   Base directory: ${resolve(baseDir)}`);
    console.log("");

    // Start all agents
    for (let i = 1; i <= agentCount; i++) {
      await this.startAgent(i, {
        baseDir,
        controllerUrl,
        agentSecretKey,
        quiet,
      });
    }

    // Wait for all agents to be ready
    await Promise.all(
      this.pendingAgents.map(
        (p) => new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Agent ${p.id} failed to start within ${this.startupTimeout}ms`));
          }, this.startupTimeout);
          
          p.resolve = () => {
            clearTimeout(timeout);
            resolve();
          };
          p.reject = (err) => {
            clearTimeout(timeout);
            reject(err);
          };
        })
      )
    );

    this.pendingAgents = [];

    console.log(`✅ All ${agentCount} agents started successfully`);
  }

  /**
   * Start a single agent process
   */
  private async startAgent(
    id: number,
    options: {
      baseDir: string;
      controllerUrl: string;
      agentSecretKey: string;
      quiet: boolean;
    }
  ): Promise<void> {
    const { baseDir, controllerUrl, agentSecretKey, quiet } = options;

    const dataDir = join(baseDir, String(id), "data");
    const modelsDir = join(baseDir, String(id), "models");
    const agentName = `Agent-${id}`;

    // Create startup promise for this agent
    let resolveStartup: () => void;
    let rejectStartup: (err: Error) => void;
    
    const startupPromise = new Promise<void>((resolve, reject) => {
      resolveStartup = () => resolve();
      rejectStartup = (err) => reject(err);
    });

    this.pendingAgents.push({
      id,
      resolve: resolveStartup!,
      reject: rejectStartup!,
    });

    // Build environment for this agent
    const env = {
      ...process.env,
      CONTROLLER_URL_WS: controllerUrl,
      AGENT_SECRET_KEY: agentSecretKey,
      AGENT_DATA_DIR: dataDir,
      MODELS_DIR: modelsDir,
      AGENT_NAME: agentName,
      // Reduce logging for non-quiet mode
      DEBUG: quiet ? "piercer:error" : "piercer:*",
    };

    // Find the agent entry point
    const agentPath = resolve(join(__dirname, "..", "agent", "index.ts"));
    
    // Spawn the agent using bun
    const childProcess = spawn("bun", ["run", agentPath], {
      env,
      stdio: quiet ? "pipe" : ["pipe", "pipe", "pipe"],
      cwd: resolve(join(__dirname, "..")),
    });

    // Handle stdout
    childProcess.stdout?.on("data", (data) => {
      const lines = data.toString().trim().split("\n");
      lines.forEach((line) => {
        if (quiet) {
          if (line.includes("Agent initialized") || line.includes("Agent running")) {
            console.log(`[Agent-${id}] ✅ Ready`);
            resolveStartup();
          }
        } else {
          console.log(`[Agent-${id}] ${line}`);
          if (line.includes("Agent initialized") || line.includes("Agent running")) {
            resolveStartup();
          }
        }
      });
    });

    // Handle stderr
    childProcess.stderr?.on("data", (data) => {
      const lines = data.toString().trim().split("\n");
      lines.forEach((line) => {
        if (line.trim()) {
          console.error(`[Agent-${id}] ERROR: ${line}`);
        }
      });
    });

    // Handle process exit
    childProcess.on("exit", (code) => {
      if (!this.isShuttingDown) {
        console.error(`[Agent-${id}] Process exited with code ${code}`);
        rejectStartup(new Error(`Agent ${id} exited with code ${code}`));
      }
    });

    // Handle process error
    childProcess.on("error", (err) => {
      console.error(`[Agent-${id}] Process error:`, err);
      rejectStartup(err);
    });

    // Store agent info
    this.agents.set(id, {
      id,
      process: childProcess,
      dataDir,
      modelsDir,
      name: agentName,
      startupPromise,
    });

    if (!quiet) {
      console.log(`[Agent-${id}] Starting... (data=${dataDir})`);
    }
  }

  /**
   * Get all running agents
   */
  getAgents(): AgentProcess[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get a specific agent by ID
   */
  getAgent(id: number): AgentProcess | undefined {
    return this.agents.get(id);
  }

  /**
   * Stop all agents gracefully
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log("\n🛑 Stopping all agents...");

    const stopPromises: Promise<void>[] = [];

    for (const [id, agent] of this.agents) {
      stopPromises.push(this.stopAgent(id));
    }

    await Promise.all(stopPromises);
    this.agents.clear();
    console.log("✅ All agents stopped");
  }

  /**
   * Stop a single agent
   */
  private async stopAgent(id: number): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) return;

    console.log(`[Agent-${id}] Stopping...`);

    return new Promise((resolve) => {
      // Send SIGTERM
      agent.process.kill("SIGTERM");

      // Give it 10 seconds to shut down gracefully
      const timeout = setTimeout(() => {
        console.log(`[Agent-${id}] Force killing...`);
        agent.process.kill("SIGKILL");
      }, 10000);

      agent.process.on("exit", () => {
        clearTimeout(timeout);
        console.log(`[Agent-${id}] Stopped`);
        resolve();
      });
    });
  }

  /**
   * Check if all agents are running
   */
  async healthCheck(): Promise<boolean> {
    for (const [, agent] of this.agents) {
      if (agent.process.exitCode !== null) {
        return false;
      }
    }
    return true;
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const agentCount = parseInt(args[0] || "2", 10);
  const controllerUrl = args[1] || "ws://localhost:4080/ws";
  const quiet = args.includes("--quiet") || args.includes("-q");

  const runner = new MultiAgentRunner({
    agentCount,
    controllerUrl,
    quiet,
  });

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await runner.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await runner.start();

    // Keep running until interrupted
    console.log("\n📋 Agents running. Press Ctrl+C to stop.\n");

    // Periodic health check
    setInterval(async () => {
      const healthy = await runner.healthCheck();
      if (!healthy) {
        console.error("⚠️  One or more agents has stopped unexpectedly");
        await runner.stop();
        process.exit(1);
      }
    }, 5000);
  } catch (err) {
    console.error("Error starting agents:", err);
    await runner.stop();
    process.exit(1);
  }
}
