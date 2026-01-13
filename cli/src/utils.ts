import chalk from "chalk";

export function handleError(error: Error): void {
  console.error(
    chalk.red("Error:"),
    error instanceof Error ? error.message : error
  );
  process.exit(1);
}

export function setupSignalHandler(): {
  aborted: boolean;
  cleanup: () => void;
} {
  let aborted = false;

  const handleSignal = () => {
    if (!aborted) {
      aborted = true;
      console.error(chalk.yellow("\n[Stopped by user]"));
    }
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  return {
    get aborted() {
      return aborted;
    },
    cleanup: () => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    },
  };
}
