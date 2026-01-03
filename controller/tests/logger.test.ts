import { test, expect } from "bun:test";
import { PinoLogger } from "../src/services/logger";
import type { Logger } from "../src/services/logger";

test("PinoLogger", () => {
  const logger = new PinoLogger({ level: "info" });

  test("should create child logger with additional context", () => {
    const childLogger = logger.child({ agentId: "test-agent" });

    expect(childLogger).toBeDefined();
    expect(childLogger).not.toBe(logger);
  });

  test("should log info messages", () => {
    // This test mainly ensures the methods don't throw errors
    expect(() => {
      logger.info("Test info message", { test: true });
    }).not.toThrow();
  });

  test("should log warning messages", () => {
    expect(() => {
      logger.warn("Test warning message", { test: true });
    }).not.toThrow();
  });

  test("should log error messages", () => {
    const error = new Error("Test error");
    expect(() => {
      logger.error("Test error message", error, { test: true });
    }).not.toThrow();
  });

  test("should log debug messages", () => {
    expect(() => {
      logger.debug("Test debug message", { test: true });
    }).not.toThrow();
  });

  test("should log fatal messages", () => {
    const error = new Error("Test fatal error");
    expect(() => {
      logger.fatal("Test fatal message", error, { test: true });
    }).not.toThrow();
  });

  test("should log agent-specific messages", () => {
    expect(() => {
      logger.agentConnected("agent-1", "Test Agent", ["completion"]);
    }).not.toThrow();

    expect(() => {
      logger.agentDisconnected("agent-1", "Connection lost");
    }).not.toThrow();

    const error = new Error("Agent error");
    expect(() => {
      logger.agentError("agent-1", error);
    }).not.toThrow();
  });

  test("should log request-specific messages", () => {
    expect(() => {
      logger.requestReceived("req-1", "completion", "llama-7b");
    }).not.toThrow();

    expect(() => {
      logger.requestCompleted("req-1", 1000);
    }).not.toThrow();

    const error = new Error("Request failed");
    expect(() => {
      logger.requestFailed("req-1", error);
    }).not.toThrow();
  });

  test("should log load balancing messages", () => {
    expect(() => {
      logger.agentSelected("agent-1", "req-1", "lowest load");
    }).not.toThrow();

    expect(() => {
      logger.noAvailableAgents("req-1");
    }).not.toThrow();
  });

  test("should log model management messages", () => {
    expect(() => {
      logger.modelMappingCreated("llama-7b.gguf", "llama-7b");
    }).not.toThrow();

    expect(() => {
      logger.modelDownloadStarted(
        "agent-1",
        "https://example.com/model.gguf",
        "model.gguf"
      );
    }).not.toThrow();

    expect(() => {
      logger.modelDownloadCompleted("agent-1", "model.gguf");
    }).not.toThrow();

    const error = new Error("Download failed");
    expect(() => {
      logger.modelDownloadFailed(
        "agent-1",
        "https://example.com/model.gguf",
        error
      );
    }).not.toThrow();
  });
});

test("Logger factory functions", () => {
  test("should create request-scoped logger", () => {
    const { createRequestLogger } = require("../src/services/logger");
    const requestLogger = createRequestLogger("req-123");

    expect(requestLogger).toBeDefined();
    expect(() => {
      requestLogger.info("Request message");
    }).not.toThrow();
  });

  test("should create agent-scoped logger", () => {
    const { createAgentLogger } = require("../src/services/logger");
    const agentLogger = createAgentLogger("agent-456");

    expect(agentLogger).toBeDefined();
    expect(() => {
      agentLogger.info("Agent message");
    }).not.toThrow();
  });
});
