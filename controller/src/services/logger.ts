import pino from "pino";

export interface LogContext {
  requestId?: string;
  agentId?: string;
  userId?: string;
  [key: string]: any;
}

// Logger Service Interface
export interface Logger {
  info(message: string, context?: Partial<LogContext>): void;
  warn(message: string, context?: Partial<LogContext>): void;
  error(
    message: string,
    error?: Error | any,
    context?: Partial<LogContext>
  ): void;
  debug(message: string, context?: Partial<LogContext>): void;
  fatal(
    message: string,
    error?: Error | any,
    context?: Partial<LogContext>
  ): void;
  child(additionalContext: Partial<LogContext>): Logger;

  // Specialized logging methods
  agentConnected(
    agentId: string,
    agentName: string,
    capabilities: string[]
  ): void;
  agentDisconnected(agentId: string, reason?: string): void;
  agentError(
    agentId: string,
    error: Error,
    context?: Partial<LogContext>
  ): void;
  requestReceived(
    requestId: string,
    type: string,
    model: string,
    context?: Partial<LogContext>
  ): void;
  requestCompleted(
    requestId: string,
    duration: number,
    context?: Partial<LogContext>
  ): void;
  requestFailed(
    requestId: string,
    error: Error,
    context?: Partial<LogContext>
  ): void;
  agentSelected(agentId: string, requestId: string, reason: string): void;
  noAvailableAgents(requestId: string): void;
  modelMappingCreated(internalName: string, publicName: string): void;
  modelDownloadStarted(
    agentId: string,
    modelUrl: string,
    filename: string
  ): void;
  modelDownloadCompleted(agentId: string, filename: string): void;
  modelDownloadFailed(agentId: string, modelUrl: string, error: Error): void;
}

// Pico Logger Implementation
export class PinoLogger implements Logger {
  private logger: pino.Logger;
  private context: LogContext;

  constructor(
    options: {
      level?: string;
      context?: LogContext;
    } = {}
  ) {
    this.logger = pino({
      level: options.level || process.env.LOG_LEVEL || "info",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string) => {
          return { level: label };
        },
      },
    });
    this.context = options.context || {};
  }

  private enrichContext(
    additionalContext: Partial<LogContext> = {}
  ): LogContext {
    return {
      ...this.context,
      ...additionalContext,
      timestamp: new Date().toISOString(),
    };
  }

  info(message: string, context: Partial<LogContext> = {}): void {
    this.logger.info(this.enrichContext(context), message);
  }

  warn(message: string, context: Partial<LogContext> = {}): void {
    this.logger.warn(this.enrichContext(context), message);
  }

  error(
    message: string,
    error?: Error | any,
    context: Partial<LogContext> = {}
  ): void {
    if (error instanceof Error) {
      this.logger.error(
        this.enrichContext({
          ...context,
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
          },
        }),
        message
      );
    } else {
      this.logger.error(this.enrichContext(context), message, error);
    }
  }

  debug(message: string, context: Partial<LogContext> = {}): void {
    this.logger.debug(this.enrichContext(context), message);
  }

  fatal(
    message: string,
    error?: Error | any,
    context: Partial<LogContext> = {}
  ): void {
    if (error instanceof Error) {
      this.logger.fatal(
        this.enrichContext({
          ...context,
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
          },
        }),
        message
      );
    } else {
      this.logger.fatal(this.enrichContext(context), message, error);
    }
  }

  // Create a child logger with additional context
  child(additionalContext: Partial<LogContext>): Logger {
    return new PinoLogger({
      level: this.logger.level,
      context: this.enrichContext(additionalContext),
    });
  }

  // Agent-specific logging methods
  agentConnected(
    agentId: string,
    agentName: string,
    capabilities: string[]
  ): void {
    this.info("Agent connected", {
      agentId,
      agentName,
      capabilities,
      event: "agent_connected",
    });
  }

  agentDisconnected(agentId: string, reason?: string): void {
    this.info("Agent disconnected", {
      agentId,
      reason,
      event: "agent_disconnected",
    });
  }

  agentError(
    agentId: string,
    error: Error,
    context: Partial<LogContext> = {}
  ): void {
    this.error("Agent error", error, {
      agentId,
      event: "agent_error",
      ...context,
    });
  }

  // Request-specific logging methods
  requestReceived(
    requestId: string,
    type: string,
    model: string,
    context: Partial<LogContext> = {}
  ): void {
    this.info("Request received", {
      requestId,
      requestType: type,
      model,
      event: "request_received",
      ...context,
    });
  }

  requestCompleted(
    requestId: string,
    duration: number,
    context: Partial<LogContext> = {}
  ): void {
    this.info("Request completed", {
      requestId,
      duration,
      event: "request_completed",
      ...context,
    });
  }

  requestFailed(
    requestId: string,
    error: Error,
    context: Partial<LogContext> = {}
  ): void {
    this.error("Request failed", error, {
      requestId,
      event: "request_failed",
      ...context,
    });
  }

  // Load balancing logging
  agentSelected(agentId: string, requestId: string, reason: string): void {
    this.debug("Agent selected for request", {
      agentId,
      requestId,
      reason,
      event: "agent_selected",
    });
  }

  noAvailableAgents(requestId: string): void {
    this.warn("No available agents for request", {
      requestId,
      event: "no_available_agents",
    });
  }

  // Model management logging
  modelMappingCreated(internalName: string, publicName: string): void {
    this.info("Model mapping created", {
      internalName,
      publicName,
      event: "model_mapping_created",
    });
  }

  modelDownloadStarted(
    agentId: string,
    modelUrl: string,
    filename: string
  ): void {
    this.info("Model download started", {
      agentId,
      modelUrl,
      filename,
      event: "model_download_started",
    });
  }

  modelDownloadCompleted(agentId: string, filename: string): void {
    this.info("Model download completed", {
      agentId,
      filename,
      event: "model_download_completed",
    });
  }

  modelDownloadFailed(agentId: string, modelUrl: string, error: Error): void {
    this.error("Model download failed", error, {
      agentId,
      modelUrl,
      event: "model_download_failed",
    });
  }
}

// Global logger instance
export const logger = new PinoLogger();

// Request-scoped logger factory
export function createRequestLogger(requestId: string): Logger {
  return logger.child({ requestId });
}

// Agent-scoped logger factory
export function createAgentLogger(agentId: string): Logger {
  return logger.child({ agentId });
}
