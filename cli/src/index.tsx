#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import OpenAI from "openai";
import { render } from "ink";
import React from "react";
import type {
  ControllerInfo,
  Agent,
  ModelMapping,
  ChatMessage,
} from "./types.js";
import {
  fetchControllerInfo,
  checkHealth,
  listAgents,
  listMappings,
  addMapping,
  removeMapping,
  downloadModel,
  createOpenAIClient,
} from "./api.js";
import { handleError as handleErrorUtil, setupSignalHandler } from "./utils.js";
import InkRepl from "./components/InkRepl.js";

const DEFAULT_URL = process.env.CONTROLLER_URL || "http://localhost:3000";

// Error handler wrapper
function handleError(fn: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      handleErrorUtil(
        error instanceof Error ? error : new Error(String(error))
      );
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
      const url = program.opts().url;
      const data = await fetchControllerInfo(url);
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
      const url = program.opts().url;
      const healthy = await checkHealth(url);

      if (healthy) {
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
      const url = program.opts().url;
      const agents = await listAgents(url);

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
      const url = program.opts().url;
      const mappings = await listMappings(url);

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
      const url = program.opts().url;
      await addMapping(url, publicName, filename);
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
      const url = program.opts().url;
      await removeMapping(url, publicName);
      console.log(chalk.green(`✓ Mapping removed: ${publicName}`));
    })
  );

// Download command

program
  .command("download <agentId> <modelUrl> <filename>")
  .description("Trigger model download on an agent")
  .action(
    handleError(async (agentId: string, modelUrl: string, filename: string) => {
      const url = program.opts().url;
      const result = await downloadModel(url, agentId, modelUrl, filename);
      console.log(chalk.green(`✓ Download started on agent ${agentId}`));
      console.log(`  URL: ${modelUrl}`);
      console.log(`  Filename: ${result.result || filename}`);
    })
  );

// Chat completion command

program
  .command("chat <model> <message>")
  .description("Send a chat completion request")
  .option(
    "-n, --max-tokens <number>",
    "Maximum number of tokens to generate",
    "1024"
  )
  .option("-r, --show-reasoning", "Show reasoning content alongside response")
  .action(
    handleError(
      async (
        model: string,
        message: string,
        options: { maxTokens?: string; showReasoning?: boolean }
      ) => {
        const url = program.opts().url;
        const openai = createOpenAIClient(url);

        console.log(chalk.gray(`Sending chat request to model: ${model}...`));

        const { aborted, cleanup } = setupSignalHandler();
        let hasReasoning = false;
        let reasoningStarted = false;
        let responseStarted = false;

        try {
          const stream = await openai.chat.completions.create({
            model,
            messages: [{ role: "user", content: message }],
            max_tokens: parseInt(options.maxTokens || "1024", 10),
            stream: true,
          });

          for await (const chunk of stream) {
            if (aborted) break;

            const delta = chunk.choices[0]?.delta as any;
            const reasoningContent = delta?.reasoning_content;
            const content = delta?.content;

            if (options.showReasoning && reasoningContent) {
              if (!reasoningStarted) {
                // Start of reasoning - print header
                console.log("\n" + chalk.cyan.bold("═══ REASONING ═══"));
                reasoningStarted = true;
                hasReasoning = true;
              }
              // Stream reasoning content as it arrives
              process.stdout.write(chalk.gray(reasoningContent));
            } else if (content) {
              // First response content after reasoning - end reasoning section if it was shown
              if (reasoningStarted && options.showReasoning) {
                console.log("\n" + chalk.cyan.bold("═══ END REASONING ═══"));
                reasoningStarted = false;
              }
              // Start of response - print header
              if (!responseStarted) {
                console.log(chalk.green.bold("═══ RESPONSE ═══"));
                responseStarted = true;
              }
              // Stream response content as it arrives
              process.stdout.write(content);
            }
          }

          // Print end markers if sections were shown
          if (options.showReasoning && reasoningStarted) {
            console.log("\n" + chalk.cyan.bold("═══ END REASONING ═══"));
          }
          if (responseStarted) {
            console.log("\n" + chalk.green.bold("═══ END RESPONSE ═══\n"));
          } else if (!options.showReasoning && hasReasoning) {
            // No response but had reasoning - just show reasoning end marker
            console.log("\n" + chalk.cyan.bold("═══ END REASONING ═══\n"));
          } else if (!responseStarted && !hasReasoning) {
            // No content at all
            console.log();
          }
        } finally {
          cleanup();
        }
      }
    )
  );

// REPL/Chat TUI command

program
  .command("repl [model]")
  .description("Start an interactive REPL for chat completion")
  .option("-r, --show-reasoning", "Show reasoning content alongside response")
  .option(
    "--url <url>",
    "Controller URL",
    process.env.CONTROLLER_URL || "http://localhost:3000"
  )
  .action(
    handleError(
      async (
        model: string | undefined,
        options: { showReasoning?: boolean; url?: string }
      ) => {
        const url = options.url || DEFAULT_URL;
        const app = render(
          <InkRepl
            baseUrl={url}
            model={model || ""}
            showReasoning={options.showReasoning || false}
          />
        );
        return app.waitUntilExit();
      }
    )
  );

// Completion command

program
  .command("complete <model> <prompt>")
  .description("Send a text completion request")
  .option(
    "-n, --max-tokens <number>",
    "Maximum number of tokens to generate",
    "1024"
  )
  .action(
    handleError(
      async (
        model: string,
        prompt: string,
        options: { maxTokens?: string }
      ) => {
        const url = program.opts().url;
        const openai = createOpenAIClient(url);

        console.log(
          chalk.gray(`Sending completion request to model: ${model}...`)
        );

        const { aborted, cleanup } = setupSignalHandler();

        try {
          const stream = await openai.completions.create({
            model,
            prompt,
            max_tokens: parseInt(options.maxTokens || "1024", 10),
            stream: true,
          });

          for await (const chunk of stream) {
            if (aborted) break;
            process.stdout.write(chunk.choices[0]?.text || "");
          }
          process.stdout.write("\n");
        } finally {
          cleanup();
        }
      }
    )
  );

program.parse();
