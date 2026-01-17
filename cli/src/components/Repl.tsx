import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type {
  ChatMessage,
  AvailableModel,
  ToolDefinition,
  ToolCall,
} from "../types.js";
import { createOpenAIClient, chat, listOpenAIModels } from "../api.js";
import type OpenAI from "openai";

interface ReplProps {
  baseUrl: string;
  model: string;
  showReasoning: boolean;
  tools?: ToolDefinition[];
  onExit?: () => void;
}

function Message({
  msg,
  showReasoning,
}: {
  msg: ChatMessage;
  showReasoning: boolean;
}) {
  const timestamp = msg.timestamp.toLocaleTimeString();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color="magenta">[ {timestamp} ]</Text>
        <Text bold color={msg.role === "user" ? "blue" : "green"}>
          {msg.role === "user" ? "You:" : "Model:"}
        </Text>
      </Text>
      {msg.role === "assistant" && showReasoning && msg.reasoning && (
        <Box marginLeft={2}>
          <Text color="gray">Reasoning: {msg.reasoning}</Text>
        </Box>
      )}
      <Box marginLeft={2}>
        <Text>{msg.content}</Text>
      </Box>
    </Box>
  );
}

export default function Repl({
  baseUrl,
  model: initialModel,
  showReasoning,
  tools = [],
  onExit,
}: ReplProps) {
  const [model, setModel] = useState(initialModel);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: `Welcome to Piercer Chat! You're now talking to ${initialModel}.\nType your message and press Enter to send.\nUse /exit to quit.${
        tools.length > 0
          ? "\nAvailable tools: " + tools.map((t) => t.function.name).join(", ")
          : ""
      }`,
      timestamp: new Date(),
      internal: true,
    },
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<string[]>([
    "Type /models to see available models",
    "Use /use <model> to switch models",
    "Use /current to see current model",
    "Use /clear to clear chat history",
    "Use /exit to quit",
  ]);
  const { write } = useStdout();

  // Execute a tool and return the result
  const executeTool = (toolCall: ToolCall): string => {
    const { name, arguments: args } = toolCall.function;

    if (name === "quack") {
      const duckArt = `>(')____,
 (\` =~~/
~^~^\`---'`;
      return `${duckArt}${model} quacked!`;
    }

    if (name === "cowsay") {
      try {
        const parsed = JSON.parse(args);
        const text = parsed.text || "";
        const line = " " + "_".repeat(text.length + 2);
        const bottomLine = " " + "-".repeat(text.length + 2);
        return `${line}
< ${text} >
${bottomLine}
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||`;
      } catch {
        return `Error: Invalid arguments for cowsay tool`;
      }
    }

    return `Unknown tool: ${name}`;
  };

  const openaiRef = useRef<OpenAI | null>(null);

  useEffect(() => {
    openaiRef.current = createOpenAIClient(baseUrl);
  }, [baseUrl]);

  const scrollToBottom = useCallback(() => {
    // In Ink, the terminal auto-scrolls, but we can force it if needed
    write("\n".repeat(10));
  }, [write]);

  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return;

    const content = input.trim();
    setInput("");
    setSuggestions([]);

    // Handle /exit command
    if (content.toLowerCase() === "/exit") {
      onExit?.();
      return;
    }

    // Handle /clear command
    if (content.toLowerCase() === "/clear") {
      setMessages([]);
      setSuggestions([
        "Type /models to see available models",
        "Use /use <model> to switch models",
        "Use /current to see current model",
        "Use /clear to clear chat history",
        "Use /exit to quit",
      ]);
      return;
    }

    // Handle /models or /list command
    if (
      content.toLowerCase() === "/models" ||
      content.toLowerCase() === "/list"
    ) {
      try {
        const openai = openaiRef.current;
        if (!openai) {
          throw new Error("OpenAI client not initialized");
        }
        const models = await listOpenAIModels(openai);
        setAvailableModels(models);
        if (models.length === 0) {
          const msg: ChatMessage = {
            role: "assistant",
            content: "No models available from the OpenAI API.",
            timestamp: new Date(),
            internal: true,
          };
          setMessages((prev) => [...prev, msg]);
        } else {
          const modelList = models
            .map((m) => `  - ${m.public_name}`)
            .join("\n");
          const msg: ChatMessage = {
            role: "assistant",
            content: `Available models:\n${modelList}`,
            timestamp: new Date(),
            internal: true,
          };
          setMessages((prev) => [...prev, msg]);
        }
        setSuggestions([
          "Type /use <model> to switch to a model",
          "Use /current to see current model",
          "Use /clear to clear chat history",
        ]);
      } catch (error) {
        const msg: ChatMessage = {
          role: "assistant",
          content: `Error fetching models: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, msg]);
      }
      return;
    }

    // Handle /current or /model command
    if (
      content.toLowerCase() === "/current" ||
      content.toLowerCase() === "/model"
    ) {
      const msg: ChatMessage = {
        role: "assistant",
        content: `Current model: ${model}`,
        timestamp: new Date(),
        internal: true,
      };
      setMessages((prev) => [...prev, msg]);
      setSuggestions([
        "Type /models to see all available models",
        "Use /use <model> to switch models",
        "Use /clear to clear chat history",
      ]);
      return;
    }

    // Handle /use <model> or /select <model> command
    const useMatch = content.match(/^\/use\s+(.+)$/i);
    const selectMatch = content.match(/^\/select\s+(.+)$/i);
    const modelName = useMatch?.[1] || selectMatch?.[1];
    if (modelName) {
      // Check if the model exists
      const matchingModel = availableModels.find(
        (m) => m.public_name.toLowerCase() === modelName.toLowerCase()
      );

      if (matchingModel) {
        setModel(matchingModel.public_name);
        const msg: ChatMessage = {
          role: "assistant",
          content: `Switched to model: ${matchingModel.public_name}`,
          timestamp: new Date(),
          internal: true,
        };
        setMessages((prev) => [...prev, msg]);
        setSuggestions([
          "Type /models to see all available models",
          "Use /current to see current model",
          "Use /clear to clear chat history",
        ]);
      } else {
        // Try to set it anyway (might be a valid model not in the list yet)
        setModel(modelName);
        const msg: ChatMessage = {
          role: "assistant",
          content: `Set model to: ${modelName}`,
          timestamp: new Date(),
          internal: true,
        };
        setMessages((prev) => [...prev, msg]);
        setSuggestions([
          "Type /models to see all available models",
          "Use /current to see current model",
          "Use /clear to clear chat history",
        ]);
      }
      return;
    }

    // Add user message
    const userMsg: ChatMessage = {
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages((prev: ChatMessage[]) => [...prev, userMsg]);

    // Add to input history
    if (content && !inputHistory.includes(content)) {
      setInputHistory((prev: string[]) => [...prev, content]);
    }
    setHistoryIndex(inputHistory.length + 1);
    setIsProcessing(true);

    try {
      const openai = openaiRef.current;
      if (!openai) {
        throw new Error("OpenAI client not initialized");
      }

      let assistantContent = "";
      let assistantReasoning = "";
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: "",
        reasoning: undefined,
        timestamp: new Date(),
      };
      setMessages((prev: ChatMessage[]) => [...prev, assistantMsg]);

      // Build messages array with hidden system prompt for tools if enabled
      const toolDescription =
        tools.length > 0
          ? `\n\nYou have access to the following tools:\n${tools
              .map((t) => {
                if (t.function.name === "quack") {
                  return "- quack: You have access to a 'quack' tool that displays a duck when called. It takes no arguments.";
                }
                if (t.function.name === "cowsay") {
                  return "- cowsay: You have access to a 'cowsay' tool that displays text in a cow's voice. Use it when asked to cowsay something. It requires a 'text' argument with the message to display.";
                }
                return `- ${t.function.name}: ${
                  t.function.description || "No description available"
                }`;
              })
              .join("\n")}`
          : "";

      const apiMessages = [...messages, userMsg]
        .filter((m) => !m.internal)
        .map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
          reasoning_content: m.reasoning,
        }));

      // Prepend hidden system message with tool descriptions if tools are enabled
      if (tools.length > 0) {
        apiMessages.unshift({
          role: "system",
          content: `You are a helpful AI assistant.${toolDescription}\nWhen you need to call a function, output your response in the format: <tool_call>{"name": "function_name", "arguments": {"arg1": "value"}}</tool_call>`,
          reasoning_content: undefined,
        });
      }

      await chat(
        openai,
        model,
        apiMessages,
        (chunk, reasoningChunk, toolCalls) => {
          if (chunk) assistantContent += chunk;
          if (reasoningChunk) assistantReasoning += reasoningChunk;

          // Handle tool calls - execute them and add to messages
          if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
              const result = executeTool(tc);
              const toolResultMsg: ChatMessage = {
                role: "tool",
                content: result,
                timestamp: new Date(),
                internal: true,
              };
              setMessages((prev) => [...prev, toolResultMsg]);
            }
          }

          setMessages((prev: ChatMessage[]) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...assistantMsg,
              content: assistantContent,
              reasoning: showReasoning ? assistantReasoning : undefined,
            };
            return updated;
          });
        },
        tools
      );
    } catch (error) {
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: `Error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        timestamp: new Date(),
      };
      setMessages((prev: ChatMessage[]) => [...prev, errorMsg]);
    }

    setIsProcessing(false);
    setTimeout(scrollToBottom, 0);
  };

  useInput(
    (
      input: string,
      key: {
        return?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        upArrow?: boolean;
        downArrow?: boolean;
      }
    ) => {
      if (key.return) {
        handleSubmit();
        return;
      }

      if (key.ctrl && input === "c") {
        onExit?.();
        return;
      }

      if (key.upArrow) {
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          if (inputHistory[newIndex]) setInput(inputHistory[newIndex]);
        }
        return;
      }

      if (key.downArrow) {
        if (historyIndex < inputHistory.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          if (inputHistory[newIndex]) setInput(inputHistory[newIndex]);
        } else {
          setHistoryIndex(inputHistory.length);
          setInput("");
        }
        return;
      }

      // Handle regular input (only if not processing)
      if (!isProcessing && !key.ctrl && !key.meta && input) {
        // Add character to input - Ink handles this differently
        // We need to track key.strokes for proper input handling
      }
    }
  );

  // Use a more robust input handling approach
  const [rawInput, setRawInput] = useState("");

  useEffect(() => {
    const handler = (data: Buffer) => {
      if (isProcessing) return;

      const str = data.toString();

      // Handle Enter
      if (str === "\n" || str === "\r") {
        setRawInput("");
        handleSubmit();
        return;
      }

      // Handle backspace
      if (str === "\x7f" || str === "\b") {
        setRawInput((prev: string) => prev.slice(0, -1));
        setInput(rawInput.slice(0, -1));
        return;
      }

      // Handle Ctrl+C
      if (str === "\x03") {
        onExit?.();
        return;
      }

      // Handle arrow keys for history
      if (str === "\x1b[A") {
        // Up arrow
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          const value = inputHistory[newIndex];
          if (value) {
            setRawInput(value);
            setInput(value);
          }
        }
        return;
      }

      if (str === "\x1b[B") {
        // Down arrow
        if (historyIndex < inputHistory.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          const value = inputHistory[newIndex];
          if (value) {
            setRawInput(value);
            setInput(value);
          }
        } else {
          setHistoryIndex(inputHistory.length);
          setRawInput("");
          setInput("");
        }
        return;
      }

      // Regular characters
      if (str.length === 1 && str >= " " && str !== "\x1b") {
        const newValue = rawInput + str;
        setRawInput(newValue);
        setInput(newValue);
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", handler);

    return () => {
      process.stdin.off("data", handler);
    };
  }, [
    input,
    historyIndex,
    inputHistory,
    isProcessing,
    messages,
    model,
    baseUrl,
    onExit,
    availableModels,
  ]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Chat messages area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {messages.map((msg: ChatMessage, index: number) => (
          <React.Fragment key={index}>
            <Message msg={msg} showReasoning={showReasoning} />
          </React.Fragment>
        ))}
        {isProcessing && (
          <Box>
            <Text color="green" bold>
              Processing...
            </Text>
          </Box>
        )}
      </Box>

      {/* Command suggestions */}
      {suggestions.length > 0 && (
        <Box marginTop={1} marginBottom={1}>
          <Text color="gray" dimColor>
            {suggestions.join(" | ")}
          </Text>
        </Box>
      )}

      {/* Status bar */}
      <Box borderStyle="single" borderColor="blue" paddingX={1}>
        <Text>
          Model: {model} | reasoning: {showReasoning ? "on" : "off"}
        </Text>
      </Box>

      {/* Input area */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={-1}>
        <Text color="gray">❯ </Text>
        <Text>{input}</Text>
        <Text>{isProcessing ? " " : "█"}</Text>
      </Box>
    </Box>
  );
}
