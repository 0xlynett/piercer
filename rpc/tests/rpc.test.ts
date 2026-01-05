import { test, expect, afterAll } from "bun:test";
import { RPC, WebSocketTransport } from "../src/index";

const port = 3030;
const servers: WebSocketTransport[] = [];

afterAll(() => {
  servers.forEach((s) => s.close());
});

test("RPC basic communication", async () => {
  const transport = new WebSocketTransport({ port });
  servers.push(transport);
  const server = new RPC(transport);
  server.expose({
    add: (a: number, b: number) => a + b,
  });

  const client = new RPC(new WebSocketTransport(`ws://localhost:${port}`));
  const remote = client.remote<any>();

  await new Promise<void>((resolve) => {
    client.on("open", () => resolve());
  });

  const result = await remote.add(2, 3);
  expect(result).toBe(5);
});

test("RPC bidirectional communication", async () => {
  const transport = new WebSocketTransport({ port: port + 1 });
  servers.push(transport);
  const server = new RPC(transport);
  server.expose({
    add: (a: number, b: number) => a + b,
  });

  const serverConnectionPromise = new Promise<string>((resolve) => {
    server.on("connection", (clientId) => resolve(clientId!));
  });

  console.log("server expose");

  const client = new RPC(new WebSocketTransport(`ws://localhost:${port + 1}`));
  client.expose({
    subtract: (a: number, b: number) => a - b,
  });

  console.log("client expose");

  const clientRemote = client.remote<any>();

  await new Promise<void>((resolve) => {
    client.on("open", () => resolve());
  });

  const result1 = await clientRemote.add(2, 3);
  expect(result1).toBe(5);

  const clientId = await serverConnectionPromise;
  const serverRemote = server.remote<any>(clientId);
  const result2 = await serverRemote.subtract(5, 3);
  expect(result2).toBe(2);
});
