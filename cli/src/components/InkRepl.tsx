import React, { useEffect } from "react";
import { render, Text } from "ink";
import { handleError as handleErrorUtil, setupSignalHandler } from "../utils";
import Repl from "./Repl";
import type { ToolDefinition } from "../types";

const DEFAULT_URL = process.env.CONTROLLER_URL || "http://localhost:4080";

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

// Ink REPL Component wrapper
function InkRepl({
  baseUrl,
  model,
  showReasoning,
  tools,
}: {
  baseUrl: string;
  model: string;
  showReasoning: boolean;
  tools?: ToolDefinition[];
}) {
  const [exit, setExit] = React.useState(false);

  useEffect(() => {
    if (exit) {
      process.exit(0);
    }
  }, [exit]);

  return (
    <>
      <Repl
        baseUrl={baseUrl}
        model={model}
        showReasoning={showReasoning}
        tools={tools}
        onExit={() => setExit(true)}
      />
      {exit && <Text color="yellow">Goodbye!</Text>}
    </>
  );
}

export default InkRepl;
