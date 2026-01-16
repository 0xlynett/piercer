/**
 * AgentService - Thin orchestrator for the agent
 * Routes requests to child processes and forwards chunks to controller
 * No buffering - just pipes data from child → controller
 */

import type { AgentConfig } from "./config.js";
import { HardwareMonitor } from "./monitoring/hardware-monitor.js";
import { ProcessManager } from "./processes/process-manager.js";
import { ModelDownloader } from "./models/model-downloader.js";
import {
  loadOrGenerateAgentId,
  listInstalledModels,
  getModelPath,
  modelExists,
  ensureDirExists,
  watchModelsFolder,
} from "./utils/filesystem.js";
import { logger } from "./utils/logger.js";
import { ModelNotFoundError, ModelLoadError } from "./utils/errors.js";
import type { MainProcessFunctions } from "./processes/types.js";

export class AgentService {
  private agentId: string = "";
  private hardwareMonitor: HardwareMonitor;
  private processManager: ProcessManager;
  private modelDownloader: ModelDownloader;
  private controllerRPC: any = null; // Will be set from index.ts
  private modelsWatcher: (() => void) | null = null;

  constructor(private config: AgentConfig) {
    this.hardwareMonitor = new HardwareMonitor();
    this.modelDownloader = new ModelDownloader(config.modelsDir);

    // Create main process functions for child processes to call
    const mainFunctions: MainProcessFunctions = {
      receiveChunk: async (params) => this.handleReceiveChunk(params),
      receiveComplete: async (params) => this.handleReceiveComplete(params),
      receiveError: async (params) => this.handleReceiveError(params),
    };

    this.processManager = new ProcessManager(
      {
        maxConcurrentModels: config.maxConcurrentModels,
      },
      mainFunctions
    );
  }

  /**
   * Initialize agent service
   */
  async initialize(): Promise<void> {
    logger.info("Initializing agent service");

    // Ensure required directories exist
    await ensureDirExists(this.config.agentDataDir);
    await ensureDirExists(this.config.modelsDir);

    // Load or generate agent ID
    this.agentId = await loadOrGenerateAgentId(this.config.agentDataDir);
    logger.info({ agentId: this.agentId }, "Agent ID loaded");

    // Initialize hardware monitoring
    await this.hardwareMonitor.initialize();
    this.hardwareMonitor.startMonitoring(this.config.hardwarePollIntervalMs);

    logger.info("Agent service initialized");
  }

  /**
   * Set controller RPC interface (called from index.ts)
   */
  setControllerRPC(rpc: any): void {
    this.controllerRPC = rpc;
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Get agent name
   */
  getAgentName(): string {
    return this.config.agentName;
  }

  /**
   * Get list of installed models
   */
  async getInstalledModels(): Promise<string[]> {
    return await listInstalledModels(this.config.modelsDir);
  }

  /**
   * THIN AGENT: Forward chunk from child process to controller immediately
   */
  private async handleReceiveChunk(params: {
    requestId: string;
    data: any;
  }): Promise<void> {
    if (!this.controllerRPC) {
      logger.error("Controller RPC not set");
      return;
    }

    try {
      // Immediately forward to controller
      await this.controllerRPC.receiveCompletion({
        agentId: this.agentId,
        requestId: params.requestId,
        data: params.data,
      });
    } catch (error) {
      logger.error(
        { error, requestId: params.requestId },
        "Error forwarding chunk"
      );
    }
  }

  /**
   * THIN AGENT: Forward completion from child process to controller
   */
  private async handleReceiveComplete(params: {
    requestId: string;
    data?: any;
  }): Promise<void> {
    if (!this.controllerRPC) {
      logger.error("Controller RPC not set");
      return;
    }

    try {
      await this.controllerRPC.receiveCompletion({
        agentId: this.agentId,
        requestId: params.requestId,
        data: params.data || "[DONE]",
      });
    } catch (error) {
      logger.error(
        { error, requestId: params.requestId },
        "Error forwarding completion"
      );
    }
  }

  /**
   * Handle error from child process
   */
  private async handleReceiveError(params: {
    requestId: string;
    error: any;
  }): Promise<void> {
    logger.error(
      { requestId: params.requestId, error: params.error },
      "Inference error from child process"
    );

    if (!this.controllerRPC) {
      return;
    }

    try {
      // Report error to controller
      await this.controllerRPC.error({
        error: params.error,
        agentId: this.agentId,
        context: { requestId: params.requestId },
      });
    } catch (error) {
      logger.error({ error }, "Error reporting to controller");
    }
  }

  /**
   * RPC Method: List all installed models
   */
  async listModels(): Promise<{ models: string[] }> {
    const models = await this.getInstalledModels();
    logger.info({ count: models.length }, "Listed models");
    return { models };
  }

  /**
   * RPC Method: Get currently loaded models
   */
  async currentModels(): Promise<{ models: string[] }> {
    const models = this.processManager.getLoadedModels();
    return { models };
  }

  /**
   * RPC Method: Start/load a model
   */
  async startModel(params: { model: string }): Promise<{ models: string[] }> {
    const modelName = params.model;
    logger.info({ modelName }, "Starting model");

    // Check if model exists
    if (!(await modelExists(this.config.modelsDir, modelName))) {
      throw new ModelNotFoundError(modelName);
    }

    // Check if already loaded
    if (this.processManager.getProcess(modelName)) {
      logger.info({ modelName }, "Model already loaded");
      return { models: this.processManager.getLoadedModels() };
    }

    // Get model path
    const modelPath = getModelPath(this.config.modelsDir, modelName);

    // Load model in child process
    try {
      await this.processManager.loadModel(modelPath, modelName);
      logger.info({ modelName }, "Model started successfully");
      return { models: this.processManager.getLoadedModels() };
    } catch (error) {
      logger.error({ modelName, error }, "Failed to start model");
      throw new ModelLoadError(modelName, error as Error);
    }
  }

  /**
   * RPC Method: Download a model
   */
  async downloadModel(params: {
    model_url: string;
    filename: string;
  }): Promise<{ filename: string }> {
    logger.info(
      { url: params.model_url, filename: params.filename },
      "Downloading model"
    );

    try {
      const filename = await this.modelDownloader.downloadModel(
        params.model_url,
        params.filename
      );
      logger.info({ filename }, "Model downloaded successfully");

      // Notify controller of updated model list
      if (this.controllerRPC) {
        try {
          const installedModels = await this.getInstalledModels();
          await this.controllerRPC.updateModels({
            agentId: this.agentId,
            models: installedModels,
          });
          logger.info(
            { count: installedModels.length },
            "Notified controller of model update"
          );
        } catch (notifyError) {
          logger.error(
            { error: notifyError },
            "Failed to notify controller of model update"
          );
        }
      }

      return { filename };
    } catch (error) {
      logger.error(
        { error, filename: params.filename },
        "Model download failed"
      );
      throw error;
    }
  }

  /**
   * RPC Method: Text completion
   */
  async completion(params: any): Promise<any> {
    const modelName = params.model;
    logger.info(
      { modelName, requestId: params.requestId },
      "Completion request"
    );

    // Ensure model is loaded
    if (!this.processManager.getProcess(modelName)) {
      logger.info({ modelName }, "Model not loaded, loading now");
      await this.startModel({ model: modelName });
    }

    // Run completion in child process (streams back via callbacks)
    await this.processManager.runCompletion(modelName, params);

    // Return immediately - streaming happens via callbacks
    return {};
  }

  /**
   * RPC Method: Chat completion
   */
  async chat(params: any): Promise<any> {
    const modelName = params.model;
    logger.info({ modelName, requestId: params.requestId }, "Chat request");

    // Ensure model is loaded
    if (!this.processManager.getProcess(modelName)) {
      logger.info({ modelName }, "Model not loaded, loading now");
      await this.startModel({ model: modelName });
    }

    // Run chat in child process (streams back via callbacks)
    await this.processManager.runChat(modelName, params);

    // Return immediately - streaming happens via callbacks
    return {};
  }

  /**
   * RPC Method: Get agent status
   */
  async status(): Promise<{ status: string; metrics?: any }> {
    const metrics = this.hardwareMonitor.getLastMetrics();
    const loadedModels = this.processManager.getLoadedModels();

    return {
      status: "idle",
      metrics: {
        hardware: metrics,
        loadedModels,
        modelCount: loadedModels.length,
      },
    };
  }

  /**
   * Start watching models folder for changes
   */
  async startWatching(): Promise<void> {
    if (this.modelsWatcher) {
      return; // Already watching
    }

    this.modelsWatcher = watchModelsFolder(
      this.config.modelsDir,
      async (models) => {
        if (!this.controllerRPC) {
          logger.warn(
            { modelCount: models.length },
            "Controller RPC not ready, skipping model notification"
          );
          return;
        }

        try {
          await this.controllerRPC.updateModels({
            agentId: this.agentId,
            models,
          });
          logger.info(
            { modelCount: models.length },
            "Notified controller of model changes"
          );
        } catch (error) {
          const serializedError =
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : String(error);
          logger.error(
            { error: serializedError, modelCount: models.length },
            "Failed to notify controller of model changes"
          );
        }
      }
    );

    logger.info("Started watching models folder for changes");
  }

  /**
   * Shutdown agent service
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down agent service");

    // Stop watching models folder
    if (this.modelsWatcher) {
      this.modelsWatcher();
      this.modelsWatcher = null;
    }

    this.hardwareMonitor.stopMonitoring();
    await this.processManager.shutdown();

    logger.info("Agent service shut down");
  }
}
