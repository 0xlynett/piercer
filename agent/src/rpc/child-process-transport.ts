import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import type { Transport } from "@piercer/rpc";

/**
 * Custom Transport implementation for @piercer/rpc that works with child_process IPC
 * Allows bidirectional RPC communication between parent and child processes
 */
export class ChildProcessTransport extends EventEmitter implements Transport {
  constructor(private process: ChildProcess) {
    super();

    // Forward IPC messages as 'message' events for RPC library
    this.process.on("message", (msg: any) => {
      this.emit("message", msg);
    });

    // Forward process events
    this.process.on("exit", (code, signal) => {
      this.emit("close", { code, signal });
    });

    this.process.on("error", (err) => {
      this.emit("error", err);
    });

    // Emit 'open' event once process is spawned
    // Child processes are immediately ready after spawn
    setImmediate(() => {
      if (this.process.connected) {
        this.emit("open");
      }
    });
  }

  send(message: any): void {
    if (!this.process.connected) {
      throw new Error("Child process is not connected");
    }
    this.process.send(message);
  }

  close(): void {
    this.process.kill();
  }
}

/**
 * Transport for use inside child process to communicate with parent
 */
export class ParentProcessTransport extends EventEmitter implements Transport {
  constructor() {
    super();

    if (!process.send) {
      throw new Error("Not running in a child process with IPC");
    }

    // Forward IPC messages from parent
    process.on("message", (msg: any) => {
      this.emit("message", msg);
    });

    // Parent process connected
    setImmediate(() => {
      this.emit("open");
    });

    // Handle disconnection
    process.on("disconnect", () => {
      this.emit("close");
    });
  }

  send(message: any): void {
    if (!process.send) {
      throw new Error("Process.send is not available");
    }
    process.send(message);
  }

  close(): void {
    process.disconnect();
  }
}
