# Piercer

Piercer is an OpenAI-compatible LLM load balancer designed to be maximally easy to deploy.

It consists of the **controller**, an HTTP and WebSocket server which implements the OpenAI API, and the **agent** which connects to the controller via an outgoing connection.

Piercer is capable of running in constrained environments such as [Vast](https://vast.ai) or [Prime Intellect](https://primeintellect.ai) containers, home GPU clusters, behind NAT, and essentially any environment where `llama.cpp` can run.

Not production-ready software! Has a lot of bugs! Please don't use it for critical stuff!

## Features

- OpenAI-compatible API
- LLM load balancing across multiple agents
- Remote model downloader
- Model mapping (public names to local files)
- Streaming responses
- Multi-model support
- Basic CLI

## Todo list

- Tool calling
- Dynamic sequence counting
- Management interface (Next.js web UI)

## Run

```
bun controller

# Create multiple agent directories
bun harness:create-dirs <num>

# Start a bunch of agents
bun harness:run

# Start the agent
bun agent
```
