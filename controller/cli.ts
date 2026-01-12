#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import OpenAI from "openai";
import blessed from "blessed";

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

// Message types for chat TUI
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  timestamp: Date;
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

// Signal handler helper for streaming commands
function setupSignalHandler(): { aborted: boolean; cleanup: () => void } {
  let aborted = false;

  const handleSignal = () => {
    if (!aborted) {
      aborted = true;
      console.error(chalk.yellow("\n[Stopped by user]"));
    }
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  return {
    get aborted() {
      return aborted;
    },
    cleanup: () => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    },
  };
}

// TUI Chat Function
async function startChatTUI(
  baseUrl: string,
  model: string,
  showReasoning: boolean
): Promise<void> {
  const openai = new OpenAI({
    baseURL: `${baseUrl}/v1`,
    apiKey: process.env.API_KEY,
  });

  // Message history
  const messages: ChatMessage[] = [];

  // Input history for arrow key navigation
  const inputHistory: string[] = [];
  let historyIndex = -1;

  // Create screen
  const screen = blessed.screen({
    smartCSR: true,
    title: `Piercer Chat - ${model}`,
    fullUnicode: true,
  });

  // Create chat log (main content area)
  const chatLog = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "80%",
    scrollable: true,
    alwaysScrollable: true,
    keys: false,
    mouse: true,
    border: {
      type: "line",
      fg: "#ffffff",
    },
    style: {
      fg: "white",
      bg: "#1a1a2e",
      border: {
        fg: "#4a9eff",
      },
    },
  });

  // Create status bar
  const statusBar = blessed.box({
    top: "80%",
    left: 0,
    width: "100%",
    height: "5%",
    style: {
      fg: "white",
      bg: "#2d2d44",
    },
    content: ` Model: ${model} | Reasoning: ${
      showReasoning ? "ON" : "OFF"
    } | /exit to quit | Ctrl+C to interrupt`,
  });

  // Create input line
  const inputLine = blessed.textbox({
    top: "85%",
    left: 0,
    width: "100%",
    height: "15%",
    inputOnFocus: true,
    border: {
      type: "line",
      fg: "#4a9eff",
    },
    style: {
      fg: "white",
      bg: "#16213e",
      focus: {
        border: {
          fg: "#00ff88",
        },
      },
    },
    placeholder:
      "Type your message... (Enter to send, Ctrl+C to quit, ↑↓ for history)",
  });

  // Create processing indicator
  const processingBox = blessed.box({
    top: "45%",
    left: "center",
    width: "30%",
    height: "3",
    align: "center",
    tags: true,
    style: {
      fg: "#00ff88",
      bg: "transparent",
    },
    content: "{bold}Processing...{/}",
    hidden: true,
  });

  // Add all elements to screen
  screen.append(chatLog);
  screen.append(statusBar);
  screen.append(inputLine);
  screen.append(processingBox);

  // Function to add a message to the chat log
  function addMessage(msg: ChatMessage) {
    const timestamp = msg.timestamp.toLocaleTimeString();
    let formattedMessage = "";

    if (msg.role === "user") {
      formattedMessage = `{bold}{magenta-fg}[${timestamp}] You:{/}\n${msg.content}\n`;
    } else {
      formattedMessage = `{bold}{green-fg}[${timestamp}] Model:{/}\n`;
      if (showReasoning && msg.reasoning) {
        formattedMessage += `{cyan-fg}Reasoning: ${msg.reasoning}{/}\n\n`;
      }
      formattedMessage += `{white-fg}${msg.content}{/}\n`;
    }

    // Append to chat log
    const currentContent = chatLog.getContent();
    chatLog.setContent(currentContent + formattedMessage + "\n");

    // Scroll to bottom
    chatLog.setScrollPerc(100);
    screen.render();
  }

  // Function to send message to model
  async function sendMessage(content: string) {
    if (!content.trim()) return;

    // Add user message to history
    const userMsg: ChatMessage = {
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
    };
    messages.push(userMsg);
    addMessage(userMsg);

    // Add to input history
    if (content.trim() && !inputHistory.includes(content.trim())) {
      inputHistory.push(content.trim());
    }
    historyIndex = inputHistory.length;

    // Show processing indicator
    processingBox.show();
    screen.render();

    try {
      // Convert messages to OpenAI format
      const openaiMessages = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const stream = await openai.chat.completions.create({
        model,
        messages: openaiMessages as any,
        max_tokens: 2048,
        stream: true,
      });

      let assistantContent = "";
      let assistantReasoning = "";
      let hasReasoning = false;
      let reasoningStarted = false;

      // Hide processing indicator
      processingBox.hide();

      // Create assistant message placeholder
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };
      messages.push(assistantMsg);

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta as any;
        const reasoningContent = delta?.reasoning_content;
        const contentDelta = delta?.content;

        if (showReasoning && reasoningContent) {
          hasReasoning = true;
          assistantReasoning += reasoningContent;
          assistantMsg.reasoning = assistantReasoning;
          assistantMsg.content += reasoningContent;
          // Update the last message
          messages[messages.length - 1] = assistantMsg;
          addMessage(assistantMsg);
          // Remove the just-added message to avoid duplication
          const lines = chatLog.getContent().split("\n");
          chatLog.setContent(lines.slice(0, -3).join("\n") + "\n");
        } else if (contentDelta) {
          assistantContent += contentDelta;
          assistantMsg.content = assistantContent;
          if (hasReasoning) {
            assistantMsg.reasoning = assistantReasoning;
          }
          // Update the last message
          messages[messages.length - 1] = assistantMsg;
          addMessage(assistantMsg);
          // Remove the just-added message to avoid duplication
          const lines = chatLog.getContent().split("\n");
          chatLog.setContent(lines.slice(0, -3).join("\n") + "\n");
        }

        screen.render();
      }

      // Final update
      const lastMessage = messages[messages.length - 1];
      if (lastMessage) {
        lastMessage.content = assistantContent;
        lastMessage.reasoning = hasReasoning ? assistantReasoning : undefined;
        addMessage(lastMessage);
      }
    } catch (error) {
      processingBox.hide();
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: `Error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        timestamp: new Date(),
      };
      messages.push(errorMsg);
      addMessage(errorMsg);
    }

    screen.render();
  }

  // Input line key handlers
  inputLine.key("enter", async () => {
    const content = inputLine.getValue();
    inputLine.setValue("");

    // Handle /exit command
    if (content.trim().toLowerCase() === "/exit") {
      screen.destroy();
      console.log(chalk.yellow("Goodbye!"));
      process.exit(0);
    }

    await sendMessage(content);
  });

  inputLine.key("up", () => {
    if (historyIndex > 0) {
      historyIndex--;
      const value = inputHistory[historyIndex];
      if (value) inputLine.setValue(value);
    }
  });

  inputLine.key("down", () => {
    if (historyIndex < inputHistory.length - 1) {
      historyIndex++;
      const value = inputHistory[historyIndex];
      if (value) inputLine.setValue(value);
    } else {
      historyIndex = inputHistory.length;
      inputLine.setValue("");
    }
  });

  inputLine.key("C-c", () => {
    screen.destroy();
    process.exit(0);
  });

  // Screen key handlers
  screen.key("C-c", () => {
    screen.destroy();
    process.exit(0);
  });

  // Handle window resize
  screen.on("resize", () => {
    chatLog.width = "100%";
    chatLog.height = "80%";
    statusBar.top = "80%";
    inputLine.top = "85%";
    processingBox.top = "45%";
    screen.render();
  });

  // Focus input line
  inputLine.focus();
  screen.render();

  // Initial welcome message
  const welcomeMsg: ChatMessage = {
    role: "assistant",
    content: `Welcome to Piercer Chat! You're now talking to ${model}.\nType your message and press Enter to send.\nUse /exit to quit.`,
    timestamp: new Date(),
  };
  addMessage(welcomeMsg);
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
        const baseUrl = getBaseUrl(program.opts().url);
        const openai = new OpenAI({
          baseURL: `${baseUrl}/v1`,
          apiKey: process.env.API_KEY,
        });

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
  .command("repl")
  .description("Start an interactive chat TUI")
  .option("-m, --model <name>", "Model to use for chat", "default")
  .option("-r, --show-reasoning", "Show reasoning content alongside response")
  .action(
    handleError(
      async (options: { model?: string; showReasoning?: boolean }) => {
        const baseUrl = getBaseUrl(program.opts().url);
        const model = options.model || "default";
        const showReasoning = options.showReasoning || false;

        console.log(chalk.gray("Starting chat TUI..."));
        await startChatTUI(baseUrl, model, showReasoning);
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
        const baseUrl = getBaseUrl(program.opts().url);
        const openai = new OpenAI({
          baseURL: `${baseUrl}/v1`,
          apiKey: process.env.API_KEY,
        });

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
