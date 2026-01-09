export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export class ModelNotFoundError extends AgentError {
  constructor(modelName: string) {
    super(`Model not found: ${modelName}`, "MODEL_NOT_FOUND", { modelName });
    this.name = "ModelNotFoundError";
  }
}

export class ModelLoadError extends AgentError {
  constructor(modelName: string, cause?: Error) {
    super(`Failed to load model: ${modelName}`, "MODEL_LOAD_ERROR", {
      modelName,
      cause: cause?.message,
    });
    this.name = "ModelLoadError";
  }
}

export class InferenceError extends AgentError {
  constructor(message: string, cause?: Error) {
    super(`Inference error: ${message}`, "INFERENCE_ERROR", {
      cause: cause?.message,
    });
    this.name = "InferenceError";
  }
}

export class ProcessError extends AgentError {
  constructor(message: string, details?: any) {
    super(`Process error: ${message}`, "PROCESS_ERROR", details);
    this.name = "ProcessError";
  }
}
