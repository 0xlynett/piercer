import { RPC, WebSocketTransport } from "@piercer/rpc";

export type DummyAgent = {
  transport: WebSocketTransport;
  rpc: RPC<any>;
};

// Global tracking of all agent transports for proper cleanup
const allTransports: WebSocketTransport[] = [];

export function trackTransport(transport: WebSocketTransport): void {
  allTransports.push(transport);
}

export function closeAllTrackedTransports(): void {
  allTransports.forEach((transport) => {
    try {
      transport.close();
    } catch {
      // Ignore errors during cleanup
    }
  });
  allTransports.length = 0;
}

/**
 * Waits for a server to be ready by polling the port.
 */
export async function waitForServer(
  hostname: string,
  port: number,
  timeoutMs: number = 10000
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://${hostname}:${port}/health`);
      if (response.ok) return;
    } catch {
      // Server not ready yet, continue waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

/**
 * Parses a Server-Sent Events (SSE) stream and returns the parsed chunks.
 */
export async function parseSSEStream(response: Response): Promise<any[]> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  const chunks: any[] = [];
  let buffer = "";
  let done = false;

  while (!done && reader) {
    const { value, done: streamDone } = await reader.read();
    done = streamDone;

    if (value) {
      buffer += decoder.decode(value, { stream: true });

      // Split by double newline (SSE message separator)
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6); // Remove "data: " prefix

          if (data === "[DONE]") {
            console.log("Received [DONE] marker");
            done = true;
            break;
          }

          try {
            const chunk = JSON.parse(data);
            console.log("Received chunk:", chunk);
            chunks.push(chunk);
          } catch (e) {
            console.error("Failed to parse chunk:", data);
          }
        }
      }
    }
  }

  return chunks;
}

/**
 * Factory function to create a dummy agent for testing.
 */
export async function createDummyAgent(
  WS_URL: string,
  agentId: string,
  agentName: string,
  installedModels: string,
  chatHandler: (params: any, rpc: RPC<any>) => Promise<void>
): Promise<DummyAgent> {
  const transport = new WebSocketTransport(WS_URL, {
    headers: {
      "agent-id": agentId,
      "agent-name": agentName,
      "agent-installed-models": installedModels,
    },
  });

  // Track this transport for cleanup
  trackTransport(transport);

  const rpc = new RPC(transport);

  // Expose Agent Functions
  rpc.expose({
    chat: async (params: any) => {
      await chatHandler(params, rpc);
    },
    startModel: async (params: any) => {
      console.log("Dummy Agent: startModel called", params);
      return { models: [installedModels] };
    },
    completion: async () => {},
    listModels: async () => ({ models: [installedModels] }),
    currentModels: async () => ({ models: [] }),
    downloadModel: async () => {},
    status: async () => ({ status: "idle" }),
  });

  // Wait for connection with timeout
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("WebSocket connection timeout"));
    }, 5000);
    transport.on("open", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  return { transport, rpc };
}
