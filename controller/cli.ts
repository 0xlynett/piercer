#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";

const DEFAULT_URL = process.env.CONTROLLER_URL || "http://localhost:3000";

function getBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

async function fetchJson<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    try {
      const errorJson = JSON.parse(errorText);
      throw new Error(errorJson.message || errorJson.error || `HTTP ${response.status}`);
    } catch {
      throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
    }
  }

  return response.json() as Promise<T>;
}

function handleError(fn: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error(chalk.red("Error:"), error instanceof Error ? error.message : error);
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
      const data = await fetchJson<{ name: string; version: string }>(
        `${baseUrl}/api/info`
      );
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
      const response = await fetch(`${baseUrl}/health`);

      if (response.ok) {
        console.log(chalk.green("✓ API is healthy"));
      } else {
        console.log(chalk.red("✗ API is unhealthy"));
        process.exit(1);
      }
    })
  );

// Agents commands

const agentsCommand = program
  .command("agents")
  .description("Manage agents");

agentsCommand
  .command("list")
  .description("List all connected agents")
  .action(
    handleError(async () => {
      const baseUrl = getBaseUrl(program.opts().url);
      const agents = await fetchJson<Array<{
        id: string;
        name: string;
        status: string;
        models: string[];
        pendingRequests: number;
        vram?: { total: number; used: number };
      }>>(`${baseUrl}/management/agents`);

      if (agents.length === 0) {
        console.log(chalk.yellow("No agents connected"));
        return;
      }

      console.log(chalk.blue(`Connected agents (${agents.length}):\n`));
      console.log(
        agents
          .map((agent) =>
            [
              chalk.white("ID:"),
              agent.id,
              chalk.white("Name:"),
              agent.name,
              chalk.white("Status:"),
              agent.status === "connected" ? chalk.green(agent.status) : chalk.yellow(agent.status),
              chalk.white("Models:"),
              (agent.models?.length ?? 0) > 0 ? agent.models?.join(", ") || "none" : chalk.gray("none"),
              chalk.white("Pending:"),
              String(agent.pendingRequests),
            ].join(" ")
          )
          .join("\n")
      );
    })
  );

agentsCommand
  .command("info <agentId>")
  .description("Get detailed info for a specific agent")
  .action(
    handleError(async (agentId: string) => {
      const baseUrl = getBaseUrl(program.opts().url);
      const agent = await fetchJson<{
        id: string;
        name: string;
        status: string;
        models: string[];
        pendingRequests: number;
        vram?: { total: number; used: number };
        system?: { cpu: number; memory: number };
      }>(`${baseUrl}/management/agents/${agentId}`);

      console.log(chalk.blue(`Agent Details: ${agent.name}\n`));
      console.log(`${chalk.white("ID:")} ${agent.id}`);
      console.log(`${chalk.white("Status:")} ${agent.status}`);
      console.log(`${chalk.white("Models:")} ${agent.models?.length > 0 ? agent.models?.join(", ") || "none" : chalk.gray("none")}`);
      console.log(`${chalk.white("Pending Requests:")} ${agent.pendingRequests}`);

      if (agent.vram) {
        const vramPercent = ((agent.vram.used / agent.vram.total) * 100).toFixed(1);
        console.log(
          `${chalk.white("VRAM:")} ${(agent.vram.used / 1024).toFixed(1)}GB / ${(agent.vram.total / 1024).toFixed(1)}GB (${vramPercent}%)`
        );
      }

      if (agent.system) {
        console.log(
          `${chalk.white("System:")} CPU ${agent.system.cpu}% | Memory ${(agent.system.memory / 1024).toFixed(1)}GB`
        );
      }
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
      const mappings = await fetchJson<Array<{ publicName: string; filename: string }>>(
        `${baseUrl}/management/mappings`
      );

      if (mappings.length === 0) {
        console.log(chalk.yellow("No model mappings configured"));
        return;
      }

      console.log(chalk.blue(`Model Mappings (${mappings.length}):\n`));
      console.log(
        mappings
          .map((m) => `${chalk.white(m.publicName)} → ${m.filename}`)
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
      await fetchJson(`${baseUrl}/management/mappings`, {
        method: "POST",
        body: JSON.stringify({ publicName, filename }),
      });
      console.log(chalk.green(`✓ Mapping created: ${publicName} → ${filename}`));
    })
  );

mappingsCommand
  .command("remove <publicName>")
  .description("Delete a model mapping")
  .action(
    handleError(async (publicName: string) => {
      const baseUrl = getBaseUrl(program.opts().url);
      await fetchJson(`${baseUrl}/management/mappings/${encodeURIComponent(publicName)}`, {
        method: "DELETE",
      });
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
      const result = await fetchJson<{ success: boolean; filename: string }>(
        `${baseUrl}/management/agents/${agentId}/models/download`,
        {
          method: "POST",
          body: JSON.stringify({ modelUrl, filename }),
        }
      );
      console.log(chalk.green(`✓ Download started on agent ${agentId}`));
      console.log(`  URL: ${modelUrl}`);
      console.log(`  Filename: ${result.filename}`);
    })
  );

program.parse();
