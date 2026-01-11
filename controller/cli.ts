#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { hc } from "hono/client";
import type { AppType } from "./src/apis/openapi";

const DEFAULT_URL = process.env.CONTROLLER_URL || "http://localhost:3000";

function getBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
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
      const client = hc<AppType>(baseUrl);
      const res = await client.api.info.$get();
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }
      const data = await res.json();
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
      const client = hc<AppType>(baseUrl);
      const res = await client.health.$get();

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
      const client = hc<AppType>(baseUrl);
      const res = await client.management.agents.$get();
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }
      const agents = await res.json();

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
              agent.status === "connected"
                ? chalk.green(agent.status)
                : chalk.yellow(agent.status),
              chalk.white("Models:"),
              (agent.loaded_models?.length ?? 0) > 0
                ? agent.loaded_models?.join(", ") || "none"
                : chalk.gray("none"),
              chalk.white("Pending:"),
              String(agent.pending_requests),
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
      const client = hc<AppType>(baseUrl);
      const res = await client.management.agents[agentId].$get();
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }
      const agent = await res.json();

      console.log(chalk.blue(`Agent Details: ${agent.name}\n`));
      console.log(`${chalk.white("ID:")} ${agent.id}`);
      console.log(`${chalk.white("Status:")} ${agent.status}`);
      console.log(
        `${chalk.white("Models:")} ${
          agent.loaded_models?.length > 0
            ? agent.loaded_models?.join(", ") || "none"
            : chalk.gray("none")
        }`
      );
      console.log(
        `${chalk.white("Pending Requests:")} ${agent.pending_requests}`
      );

      if (agent.vram_total && agent.vram_used) {
        const vramPercent = (
          (agent.vram_used / agent.vram_total) *
          100
        ).toFixed(1);
        console.log(
          `${chalk.white("VRAM:")} ${(agent.vram_used / 1024).toFixed(
            1
          )}GB / ${(agent.vram_total / 1024).toFixed(1)}GB (${vramPercent}%)`
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
      const client = hc<AppType>(baseUrl);
      const res = await client.management.mappings.$get();
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }
      const mappings = await res.json();

      if (mappings.length === 0) {
        console.log(chalk.yellow("No model mappings configured"));
        return;
      }

      console.log(chalk.blue(`Model Mappings (${mappings.length}):\n`));
      console.log(
        mappings
          .map((m) => `${chalk.white(m.public_name)} → ${m.filename}`)
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
      const client = hc<AppType>(baseUrl);
      const res = await client.management.mappings.$post({
        json: { public_name: publicName, filename },
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }
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
      const client = hc<AppType>(baseUrl);
      const res = await client.management.mappings[
        encodeURIComponent(publicName)
      ].$delete();
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }
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
      const client = hc<AppType>(baseUrl);
      const res = await client.management.agents[agentId].models.download.$post(
        {
          json: { model_url: modelUrl, filename },
        }
      );
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }
      const result = await res.json();
      console.log(chalk.green(`✓ Download started on agent ${agentId}`));
      console.log(`  URL: ${modelUrl}`);
      console.log(`  Filename: ${result.result || filename}`);
    })
  );

program.parse();
