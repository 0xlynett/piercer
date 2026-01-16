import { defaultContainer } from "./module";

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  defaultContainer
    .getLogger()
    .info(`Received ${signal}, starting graceful shutdown...`);

  await defaultContainer.shutdown();

  defaultContainer.getLogger().info("Graceful shutdown completed");
  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start default server in production

defaultContainer.startServer();
