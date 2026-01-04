export interface Transport {
  send(message: any): void;
  on(event: "message", listener: (message: any) => void): void;
  on(event: "open" | "connection", listener: (clientId?: string) => void): void;
  on(
    event: "close" | "disconnection",
    listener: (clientId?: string) => void
  ): void;
}

export class RPC<T extends Record<string, Function>> {
  private transport: Transport;
  private exposedMethods: T | null = null;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  expose(methods: T): void {
    this.exposedMethods = methods;
  }

  remote<TRemote extends Record<string, Function>>(): TRemote {
    const proxy = new Proxy({} as TRemote, {
      get: (target, prop, receiver) => {
        if (typeof prop === "string") {
          return (...args: any[]) => {
            // TODO: Implement the logic to send the RPC call
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    return proxy;
  }

  on(
    event: "open" | "connection",
    listener: (clientId?: string) => void
  ): void {
    this.transport.on(event, listener);
  }

  on(
    event: "close" | "disconnection",
    listener: (clientId?: string) => void
  ): void {
    this.transport.on(event, listener);
  }
}
