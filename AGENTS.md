Piercer is a tool for load-balances LLM requests. The main control server known as **controller** exposes an OpenAI-compatible API, a management API, and routes requests to agents, based on load and model support. The **management interface** is a Next.js based app which controls the controller using the controller's management HTTP API.

For OpenAI API reference, use the OpenAI and OpenRouter docs on Legacy Completions ([OpenAI](https://platform.openai.com/docs/api-reference/completions), [OpenRouter](https://openrouter.ai/docs/api/api-reference/completions/create-completions)) and Chat Completions ([OpenAI](https://platform.openai.com/docs/api-reference/chat), [OpenRouter](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)).

A **controller** is a server that manages "agents": clients which run the actual workloads. agents make outbound WebSocket connections to the controller , which also exposes an OpenAI-compatible API. Its code is in `./controller` and can be started by running `bun run controller`.

The controller keeps track of pending requests for load-balancing purposes.

An **agent** is a server running on a GPU node or other compute machine. It runs the underlying LLM using llama.cpp (via [node-llama-cpp](https://npmjs.com/package/node-llama-cpp)). Its code is in `./agent` and can be started by running `bun run agent`.

When `modelStart()` is received by an agent, it creates a new child process with a new path. This is because we don't want accidental memory leaks: if node-llama-cpp is isolated in its own process, it's less likely to happen.

Killing an older child process is a decision done based on VRAM (or if the main processing is done on CPU, RAM): if there is enough VRAM to fit the new model while leaving room for inference, then it will not kill anything. The choice of process to kill is done based on an unmentioned priority system, but it will not kill a model which is still generating tokens. If there are no available models to kill, it will queue the creation request.

Environment variables are in the `.env` of the root directory.

agent models are stored in `./models` (relative to cwd). Note that agents use filenames to identify models, and these need to be translated by controllers into one consistent model name for external use.

# Tooling

Piercer uses the `bun` package manager, but the `node` runtime. This is due to Bun's overall instability with native bindings like node-llama-cpp.

If there are no models in the `models` directory or if it doesn't exist, it is recommended to set it up by running `bun clean` to create it, then running the following to pull some small models to your home directory:

```
bunx node-llama-cpp pull https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf
bunx node-llama-cpp pull https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf
```

# Management Interface

Next.js app with authentication and clean layout for visualization.

# Management API

An HTTP API from the controller that includes:

- `GET /management/agents`: Returns a list of connected agents and their stats.
- `POST /management/mappings`: Creates a new model mapping. Requires `public_name` and `filename` in the request body.
- `GET /management/mappings`: Retrieves all model mappings.
- `DELETE /management/mappings/:publicName`: Deletes a model mapping.
- `POST /management/agents/:agentId/models/download`: Triggers a model download on a specific agent. Requires `model_url` and `filename` in the request body.

# Agent-Controller RPC Architecture

Piercer uses a bidirectional RPC library, @piercer/rpc (found in this repo) for controller-agent communication.

## Agent Identification

Agents identify themselves via HTTP headers during WebSocket upgrade:

- `agent-id` - The agent's unique identifier
- `agent-name` - The agent's human-readable name
- `Authorization` - Bearer token matching `AGENT_SECRET_KEY` (if configured)

If two agents of the same ID connect the controller, it should kick out the older agent and accept the newer one.

## Message Format

```jsonc
// Request: { "type": "req", "proc": "completion", "req": "uuid", "params": {...} }
// Response: { "type": "res", "req": "uuid", "result": {...} }
// Error: { "type": "error", "req": "uuid", "error": {"code": "...", "message": "..."} }
// Event: { "type": "event", "event": "event.name", "req": "uuid", "data": {...} }
```

## Flows

### agent flow

1. agent boots
2. agent checks local SQLite database to find its ID
   - On first boot, generate a new ID and name
3. agent connects to the controller over WebSocket, identifying itself using ID and name in HTTP headers
4. controller keeps track of the agent
5. controller can call procedures on agent (model.list, completion, etc.)

### Model download flow

1. controller calls `model.download` procedure on agent
2. agent downloads the model from the given URL into the `models` folder
3. agent returns the filename of the downloaded model

### Request / load-balancing flow

1. controller receives a completion request over OpenAI API, validating it
2. controller selects the agent by order of priority
   1. agent with zero pending requests and the model loaded
   2. agent with zero pending requests and the model installed (but not loaded)
   3. agent with least pending requests and the model loaded
   4. agent with least pending requests and the model installed (but not loaded)
   - In case of a tie, use ID order.
3. If unloaded, controller calls `model.start` procedure on agent
4. controller calls `completion` or `chat` procedure on selected agent
5. agent streams back `completion` or `chat` responses
6. controller streams the responses back to requester (if streaming is on) or sends it once done

# WebSocket API

## controller -> agent (controller calls these on agent)

- `completion()` - Creates a completion, returns a stream
- `chat()` - Creates a chat completion, returns a stream
- `listModels()` - Lists available models, returns `{ models: string[] }`
- `currentModels()` - Gets the agent's currently loaded models, returns `{ models: string[] }`
- `startModel()` - Changes loaded model, returns `{ models: string[] }`
- `downloadModel()` - Downloads model from URL and renames it to provided filename
- `status()` - Gets agent status, returns `{ status: agentStatus }`

## agent -> controller (agent calls these on controller)

- `error()` - Any error happening on the agent as a result of a request or other
- `receiveCompletion()` - Receives a completion stream via KKRPC

# Special Agent Instructions

These instructions serve as good defaults.

- Don't start servers.
- Don't write any Markdown files for storing plans.
- If changes are made, review this document (`AGENTS.md`) and edit it.
- Ask the user if anything is unclear.
- When making a new package, DO NOT CREATE A PACKAGES FOLDER and generally try to follow the folder structure as seen in other packages.
- Default to using bun as package manager and runtime unless node is specified.
