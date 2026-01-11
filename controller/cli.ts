#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";

const DEFAULT_URL = process.env.CONTROLLER_URL || "http://localhost:3000";

// Type definitions for API responses
interface ControllerInfo {
  name: string;
  version: string;
}

interface Agent {
  id: string;
  name: string;
  loadedModels: string[];
  installedModels: string[];
  pendingRequests: number;
  status?: string;
  vram_used?: number;
  vram_total?: number;
}

interface ModelMapping {
  public_name: string;
  internal_name: string;
}

function getBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

async function request<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

function handleError(fn: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error(
        chalk.red("Error:"),
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  };
}

const program = new Command();

program
  .name("piercer")
  .description("CLI tool for Piercer management API")
  .version("1.0.0")
  .option("--url <url>", "Controller URL", DEFAULT_URL);

// Utility commands

program
  .command("info")
  .description("Show API information")
  .action(
    handleError(async () => {
      const baseUrl = getBaseUrl(program.opts().url);
      const data = await request<ControllerInfo>(baseUrl, "/api/info");
      console.log(chalk.blue("Piercer Controller"));
      console.log(`Name: ${data.name}`);
      console.log(`Version: ${data.version}`);
    })
  );

program
  .command("health")
  .description("Check API health")
  .action(
    handleError(async () => {
      const baseUrl = getBaseUrl(program.opts().url);
      const url = `${baseUrl}/health`;
      const res = await fetch(url);

      if (res.ok) {
        console.log(chalk.green("✓ API is healthy"));
      } else {
        console.log(chalk.red("✗ API is unhealthy"));
        process.exit(1);
      }
    })
  );

// Agents commands

const agentsCommand = program.command("agents").description("Manage agents");

agentsCommand
  .command("list")
  .description("List all connected agents")
  .action(
    handleError(async () => {
      const baseUrl = getBaseUrl(program.opts().url);
      const agents = await request<Agent[]>(baseUrl, "/management/agents");

      if (agents.length === 0) {
        console.log(chalk.yellow("No agents connected"));
        return;
      }

      console.log(chalk.blue(`Connected agents (${agents.length}):\n`));

      const text = agents.map((agent) =>
        [
          chalk.white("ID:"),
          chalk.magenta(agent.id),
          chalk.yellow(`(${agent.name})`),
          "\n  ",
          chalk.white("Loaded:"),
          (agent.loadedModels?.length ?? 0) > 0
            ? agent.loadedModels?.join(", ") || "none"
            : chalk.gray("none"),
          "\n  ",
          chalk.white("Installed:"),
          (agent.installedModels?.length ?? 0) > 0
            ? agent.installedModels?.join(", ") || "none"
            : chalk.gray("none"),
          "\n  ",
          chalk.white("Pending requests:"),
          String(agent.pendingRequests),
        ].join(" ")
      );

      text.forEach((t) => console.log(t));
    })
  );

// Model Mappings commands

const mappingsCommand = program
  .command("mappings")
  .description("Manage model mappings");

mappingsCommand
  .command("list")
  .description("List all model mappings")
  .action(
    handleError(async () => {
      const baseUrl = getBaseUrl(program.opts().url);
      const mappings = await request<ModelMapping[]>(
        baseUrl,
        "/management/mappings"
      );

      if (mappings.length === 0) {
        console.log(chalk.yellow("No model mappings configured"));
        return;
      }

      console.log(chalk.blue(`Model Mappings (${mappings.length}):\n`));
      console.log(
        mappings
          .map((m) => `${chalk.white(m.public_name)} → ${m.internal_name}`)
          .join("\n")
      );
    })
  );

mappingsCommand
  .command("add <publicName> <filename>")
  .description("Create a model mapping")
  .action(
    handleError(async (publicName: string, filename: string) => {
      const baseUrl = getBaseUrl(program.opts().url);
      await request(baseUrl, "/management/mappings", {
        method: "POST",
        body: JSON.stringify({ public_name: publicName, filename }),
      });
      console.log(
        chalk.green(`✓ Mapping created: ${publicName} → ${filename}`)
      );
    })
  );

mappingsCommand
  .command("remove <publicName>")
  .description("Delete a model mapping")
  .action(
    handleError(async (publicName: string) => {
      const baseUrl = getBaseUrl(program.opts().url);
      await request(
        baseUrl,
        `/management/mappings/${encodeURIComponent(publicName)}`,
        { method: "DELETE" }
      );
      console.log(chalk.green(`✓ Mapping removed: ${publicName}`));
    })
  );

// Download command

program
  .command("download <agentId> <modelUrl> <filename>")
  .description("Trigger model download on an agent")
  .action(
    handleError(async (agentId: string, modelUrl: string, filename: string) => {
      const baseUrl = getBaseUrl(program.opts().url);
      const result = await request<{ result?: string }>(
        baseUrl,
        `/management/agents/${encodeURIComponent(agentId)}/models/download`,
        {
          method: "POST",
          body: JSON.stringify({ model_url: modelUrl, filename }),
        }
      );
      console.log(chalk.green(`✓ Download started on agent ${agentId}`));
      console.log(`  URL: ${modelUrl}`);
      console.log(`  Filename: ${result.result || filename}`);
    })
  );

program.parse();
