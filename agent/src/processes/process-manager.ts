import { fork } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { RPC } from "@piercer/rpc";
import { ChildProcessTransport } from "../rpc/child-process-transport.js";
import { logger } from "../utils/logger.js";
import { ProcessError } from "../utils/errors.js";
import type {
  ManagedProcess,
  InferenceProcessFunctions,
  MainProcessFunctions,
  CompletionParams,
  ChatParams,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private mainFunctions: MainProcessFunctions;

  constructor(
    private config: {
      maxConcurrentModels: number;
      defaultContextSize: number;
    },
    mainFunctions: MainProcessFunctions
  ) {
    this.mainFunctions = mainFunctions;
  }

  /**
   * Spawn a new child process and load a model
   */
  async loadModel(
    modelPath: string,
    modelName: string
  ): Promise<ManagedProcess> {
    // Check if already loaded
    if (this.processes.has(modelName)) {
      logger.info({ modelName }, "Model already loaded");
      return this.processes.get(modelName)!;
    }

    // Check if we need to unload a model first
    if (this.processes.size >= this.config.maxConcurrentModels) {
      await this.unloadLeastUsedModel();
    }

    logger.info({ modelName, modelPath }, "Spawning inference process");

    // Fork child process
    const processPath = join(__dirname, "inference-process.js");
    const childProcess = fork(processPath, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        MODEL_NAME: modelName,
      },
    });

    // Setup bidirectional RPC
    const transport = new ChildProcessTransport(childProcess);
    const rpc = new RPC<MainProcessFunctions>(transport);

    // Expose main process functions for child to call
    rpc.expose(this.mainFunctions);

    // Get remote interface to call child functions
    const remote = rpc.remote<InferenceProcessFunctions>();

    const managedProcess: ManagedProcess = {
      modelName,
      process: childProcess,
      rpc,
      remote,
      isGenerating: false,
      requestCount: 0,
      startedAt: new Date(),
    };

    // Handle process events
    childProcess.on("exit", (code, signal) => {
      logger.warn(
        { modelName, code, signal },
        "Inference process exited"
      );
      this.processes.delete(modelName);
    });

    childProcess.on("error", (err) => {
      logger.error({ modelName, error: err }, "Inference process error");
      this.processes.delete(modelName);
    });

    // Store the process
    this.processes.set(modelName, managedProcess);

    // Load the model in the child process
    try {
      const result = await remote.loadModel({
        modelPath,
        contextSize: this.config.defaultContextSize,
      });

      if (!result.success) {
        throw new ProcessError(`Failed to load model: ${result.error}`);
      }

      logger.info({ modelName }, "Model loaded successfully");
      return managedProcess;
    } catch (error) {
      logger.error({ modelName, error }, "Failed to load model in child process");
      await this.unloadModel(modelName);
      throw error;
    }
  }

  /**
   * Get a loaded process for a model
   */
  getProcess(modelName: string): ManagedProcess | undefined {
    return this.processes.get(modelName);
  }

  /**
   * Get all currently loaded models
   */
  getLoadedModels(): string[] {
    return Array.from(this.processes.keys());
  }

  /**
   * Unload a specific model
   */
  async unloadModel(modelName: string): Promise<void> {
    const proc = this.processes.get(modelName);
    if (!proc) {
      return;
    }

    logger.info({ modelName }, "Unloading model");

    try {
      // Try graceful shutdown
      await proc.remote.shutdown();
    } catch (error) {
      logger.warn({ modelName, error }, "Error during graceful shutdown");
    }

    // Force kill if still alive
    if (!proc.process.killed) {
      proc.process.kill("SIGTERM");

      // Force kill after 5 seconds
      setTimeout(() => {
        if (!proc.process.killed) {
          proc.process.kill("SIGKILL");
        }
      }, 5000);
    }

    this.processes.delete(modelName);
  }

  /**
   * Unload the least recently used model (that's not currently generating)
   */
  private async unloadLeastUsedModel(): Promise<void> {
    // Find processes not currently generating
    const candidates = Array.from(this.processes.entries())
      .filter(([_, proc]) => !proc.isGenerating)
      .sort((a, b) => a[1].requestCount - b[1].requestCount);

    if (candidates.length === 0) {
      throw new ProcessError(
        "Cannot unload any model - all are currently generating"
      );
    }

    const [modelName, _] = candidates[0];
    logger.info({ modelName }, "Unloading least used model");
    await this.unloadModel(modelName);
  }

  /**
   * Run a completion request
   */
  async runCompletion(
    modelName: string,
    params: CompletionParams
  ): Promise<void> {
    const proc = this.processes.get(modelName);
    if (!proc) {
      throw new ProcessError(`Model not loaded: ${modelName}`);
    }

    proc.isGenerating = true;
    proc.requestCount++;

    try {
      await proc.remote.completion(params);
    } finally {
      proc.isGenerating = false;
    }
  }

  /**
   * Run a chat request
   */
  async runChat(modelName: string, params: ChatParams): Promise<void> {
    const proc = this.processes.get(modelName);
    if (!proc) {
      throw new ProcessError(`Model not loaded: ${modelName}`);
    }

    proc.isGenerating = true;
    proc.requestCount++;

    try {
      await proc.remote.chat(params);
    } finally {
      proc.isGenerating = false;
    }
  }

  /**
   * Shutdown all processes
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down all processes");

    const modelNames = Array.from(this.processes.keys());
    await Promise.all(modelNames.map((name) => this.unloadModel(name)));
  }
}
