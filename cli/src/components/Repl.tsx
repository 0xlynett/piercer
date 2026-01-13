import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { ChatMessage, AvailableModel } from "../types.js";
import { createOpenAIClient, chat, listOpenAIModels } from "../api.js";
import type OpenAI from "openai";

interface ReplProps {
  baseUrl: string;
  model: string;
  showReasoning: boolean;
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
  onExit,
}: ReplProps) {
  const [model, setModel] = useState(initialModel);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: `Welcome to Piercer Chat! You're now talking to ${initialModel}.\nType your message and press Enter to send.\nUse /exit to quit.`,
      timestamp: new Date(),
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
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };
      setMessages((prev: ChatMessage[]) => [...prev, assistantMsg]);

      await chat(
        openai,
        model,
        [...messages, userMsg].map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
        (chunk) => {
          assistantContent += chunk;
          setMessages((prev: ChatMessage[]) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...assistantMsg,
              content: assistantContent,
            };
            return updated;
          });
        }
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
          Model: {model} | Reasoning: {showReasoning ? "ON" : "OFF"}
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
