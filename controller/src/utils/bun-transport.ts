import { EventEmitter } from "events";
import type { Transport } from "@piercer/rpc";
import type { WSContext } from "hono/ws";

export class BunTransport extends EventEmitter implements Transport {
  private clients = new Map<string, WSContext>();
  private wsToId = new Map<WSContext, string>();

  constructor() {
    super();
  }

  send(message: any, clientId?: string): void {
    if (clientId) {
      const client = this.clients.get(clientId);
      if (client) {
        client.send(JSON.stringify(message));
      } else {
        console.error(`Client ${clientId} not found`);
      }
    } else {
      for (const client of this.clients.values()) {
        client.send(JSON.stringify(message));
      }
    }
  }

  registerClient(ws: WSContext, clientId: string) {
    this.clients.set(clientId, ws);
    this.wsToId.set(ws, clientId);
    this.emit("connection", clientId);
  }

  removeClient(ws: WSContext) {
    const clientId = this.wsToId.get(ws);
    if (clientId) {
      this.clients.delete(clientId);
      this.wsToId.delete(ws);
      this.emit("disconnection", clientId);
    }
  }

  getClientId(ws: WSContext): string | undefined {
    return this.wsToId.get(ws);
  }

  handleMessage(ws: WSContext, data: any) {
    console.log("BunTransport handling message:", data);
    const clientId = this.wsToId.get(ws);

    // hono/ws doesn't expose anything to allow us to uniquely ID a client
    // as such we have to trust that clients don't know request IDs

    /*if (!clientId) {
      console.log("No client ID");
      console.log(ws);
      return;
    }*/
    let parsed;
    try {
      parsed = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      console.error("Failed to parse message", e);
      return;
    }
    console.log(`BunTransport received from ${clientId}:`, parsed);
    this.emit("message", parsed, clientId);
  }
}
