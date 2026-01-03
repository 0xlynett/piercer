# Piercer

Piercer is an OpenAI-compatible LLM load balancer designed to be maximally easy to deploy.

It consists of the **controller**, an HTTP and WebSocket server which implements the OpenAI API, and the **agent** which connects to the controller via an outgoing connection.

Piercer is capable of running in constrained environments such as [Vast](https://vast.ai) or [Prime Intellect](https://primeintellect.ai) containers, home GPU clusters, behind NAT, and essentially any environment where `llama.cpp` can run.
