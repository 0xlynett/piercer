import { RPC, WebSocketTransport } from "@piercer/rpc";

const AGENT_ID = "agent-" + Math.random().toString(36).substring(2, 9);
const AGENT_NAME = "Test Agent";
const CONTROLLER_URL = process.env.CONTROLLER_URL || "ws://localhost:4080/ws";

console.log(`Starting agent ${AGENT_ID} connecting to ${CONTROLLER_URL}`);

const transport = new WebSocketTransport(CONTROLLER_URL, {
  headers: {
    "agent-id": AGENT_ID,
    "agent-name": AGENT_NAME,
    "agent-installed-models": "model-a,model-b",
  },
});

const rpc = new RPC(transport);

rpc.expose({
  completion: async (params: any) => {
    console.log("Received completion request", params);
    // Simulate streaming or result
    return { text: "Hello from agent!" };
  },
  chat: async (params: any) => {
    console.log("Received chat request", params);
    return {
      message: { role: "assistant", content: "Hello from agent chat!" },
    };
  },
  listModels: async () => {
    console.log("Received listModels request");
    return { models: ["model-a", "model-b"] };
  },
  currentModels: async () => {
    return { models: [] };
  },
  startModel: async (params: any) => {
    console.log("Received startModel request", params);
    return { models: [params.model] };
  },
  downloadModel: async (params: any) => {
    console.log("Received downloadModel request", params);
    return { filename: "model.gguf" };
  },
  status: async () => {
    return { status: "idle" };
  },
});

transport.on("open", () => {
  console.log("Connected to controller");
});

transport.on("close", () => {
  console.log("Disconnected from controller");
});

transport.on("error", (err: any) => {
  console.error("Transport error:", err);
});

// Keep alive
setInterval(() => {}, 1000);
