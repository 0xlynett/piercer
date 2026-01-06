import type { EventEmitter } from "events";

export interface Transport extends EventEmitter {
  send(message: any, clientId?: string): void;
}

export class RPC<T extends Record<string, Function>> {
  private transport: Transport;
  private exposedMethods: T | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  >();

  constructor(transport: Transport) {
    this.transport = transport;
    this.transport.on("message", (message: any, clientId?: string) =>
      this.handleMessage(message, clientId)
    );
  }

  expose(methods: T): void {
    this.exposedMethods = methods;
  }

  remote<TRemote extends Record<string, Function>>(clientId?: string): TRemote {
    return new Proxy({} as TRemote, {
      get: (target, prop, receiver) => {
        if (typeof prop === "string") {
          return (...args: any[]) => {
            const id = this.generateId();
            const request = {
              jsonrpc: "2.0",
              method: prop,
              params: args,
              id,
            };
            console.log("sending");
            this.transport.send(request, clientId);
            return new Promise((resolve, reject) => {
              this.pendingRequests.set(id, { resolve, reject });
            });
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  on(
    event: "open" | "connection" | "close" | "disconnection",
    listener: (clientId?: string) => void
  ): void {
    this.transport.on(event, listener as any);
  }

  private handleMessage(message: any, clientId?: string): void {
    console.log(`Received message for ${clientId}:`, message);
    if (message.id && this.pendingRequests.has(message.id)) {
      const promise = this.pendingRequests.get(message.id);
      if (promise) {
        if (message.error) {
          promise.reject(message.error);
        } else {
          promise.resolve(message.result);
        }
        this.pendingRequests.delete(message.id);
      }
    } else if (message.method && this.exposedMethods?.[message.method]) {
      const method = this.exposedMethods[message.method];
      if (!method) return;
      Promise.resolve(method.apply(null, message.params))
        .then((result) => {
          if (message.id) {
            this.transport.send(
              { jsonrpc: "2.0", result, id: message.id },
              clientId
            );
          }
        })
        .catch((error) => {
          if (message.id) {
            this.transport.send(
              {
                jsonrpc: "2.0",
                error: { code: -32000, message: error.message },
                id: message.id,
              },
              clientId
            );
          }
        });
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2);
  }
}

export * from "./ws-transport";
