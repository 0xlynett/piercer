import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { ChatMessage } from "../types.js";

interface ReplProps {
  baseUrl: string;
  model: string;
  showReasoning: boolean;
  onExit?: () => void;
}

// Simulated OpenAI client for demo - replace with actual client
interface OpenAIClient {
  chat: {
    completions: {
      create: (options: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        max_tokens: number;
        stream: boolean;
      }) => AsyncIterable<any>;
    };
  };
}

function createOpenAIClient(baseUrl: string): OpenAIClient {
  return {
    chat: {
      completions: {
        create: async function* (_options: {
          model: string;
          messages: Array<{ role: string; content: string }>;
          max_tokens: number;
          stream: boolean;
        }) {
          // This would be replaced with actual OpenAI streaming
          // For demo purposes, we simulate a response
          const response = `This is a simulated response from the model. In a real implementation, this would stream from the OpenAI-compatible API at ${baseUrl}.`;
          for (const char of response) {
            yield {
              choices: [
                {
                  delta: { content: char },
                },
              ],
            };
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        },
      },
    },
  };
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
          <Text color="cyan">Reasoning: {msg.reasoning}</Text>
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
  model,
  showReasoning,
  onExit,
}: ReplProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: `Welcome to Piercer Chat! You're now talking to ${model}.\nType your message and press Enter to send.\nUse /exit to quit.`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const { write } = useStdout();

  const openaiRef = useRef<OpenAIClient | null>(null);

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

    // Handle /exit command
    if (content.toLowerCase() === "/exit") {
      onExit?.();
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
    setInput("");
    setIsProcessing(true);

    try {
      const openai = openaiRef.current;
      if (!openai) {
        throw new Error("OpenAI client not initialized");
      }

      const stream = await openai.chat.completions.create({
        model,
        messages: [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: 2048,
        stream: true,
      });

      let assistantContent = "";
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };
      setMessages((prev: ChatMessage[]) => [...prev, assistantMsg]);

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta as any;
        const contentDelta = delta?.content;

        if (contentDelta) {
          assistantContent += contentDelta;
          setMessages((prev: ChatMessage[]) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...assistantMsg,
              content: assistantContent,
            };
            return updated;
          });
        }
      }
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
          setInput(inputHistory[newIndex]);
        }
        return;
      }

      if (key.downArrow) {
        if (historyIndex < inputHistory.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setInput(inputHistory[newIndex]);
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
          setRawInput(value);
          setInput(value);
        }
        return;
      }

      if (str === "\x1b[B") {
        // Down arrow
        if (historyIndex < inputHistory.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          const value = inputHistory[newIndex];
          setRawInput(value);
          setInput(value);
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

      {/* Status bar */}
      <Box borderStyle="single" borderColor="blue" paddingX={1}>
        <Text>
          Model: {model} | Reasoning: {showReasoning ? "ON" : "OFF"} | /exit to
          quit
        </Text>
      </Box>

      {/* Input area */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={-1}>
        <Text color="gray">❯ </Text>
        <Text>{input}</Text>
        <Text cursor={isProcessing ? " " : "█"} />
      </Box>
    </Box>
  );
}
