import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { Transport } from "./index";
import { EventEmitter } from "events";

export class WebSocketTransport extends EventEmitter implements Transport {
  private ws: WebSocket | WebSocketServer;
  private clients = new Map<string, WebSocket>();

  constructor(
    urlOrOptions: string | { port: number; host?: string },
    options?: any
  ) {
    super();
    if (typeof urlOrOptions === "string") {
      this.ws = new WebSocket(urlOrOptions, undefined, options);
      this.ws.on("open", () => this.emit("open"));
      this.ws.on("close", () => this.emit("close"));
      this.ws.on("message", (data: RawData) =>
        this.emit("message", JSON.parse(data.toString()))
      );
    } else {
      this.ws = new WebSocketServer(urlOrOptions);
      this.ws.on("connection", (ws: WebSocket) => {
        const clientId = this.generateId();
        this.clients.set(clientId, ws);
        this.emit("connection", clientId);
        ws.on("message", (data: RawData) => {
          this.emit("message", JSON.parse(data.toString()), clientId);
        });
        ws.on("close", () => {
          this.clients.delete(clientId);
          this.emit("disconnection", clientId);
        });
      });
    }
  }

  send(message: any, clientId?: string): void {
    console.log("WebSocketTransport sending:", message);
    if (this.ws instanceof WebSocket) {
      this.ws.send(JSON.stringify(message));
    } else if (clientId) {
      const client = this.clients.get(clientId);
      if (client) {
        client.send(JSON.stringify(message));
      } else {
        console.error(`Client ${clientId} not found`);
      }
    } else {
      // Broadcast to all clients
      for (const client of this.clients.values()) {
        client.send(JSON.stringify(message));
      }
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2);
  }

  close(): void {
    this.ws.close();
  }
}
