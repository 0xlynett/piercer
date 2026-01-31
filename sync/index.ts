#!/usr/bin/env bun
/**
 * File sync tool - syncs local changes to a remote server
 * Respects .gitignore but always includes .env files
 */

import { watch } from "fs";
import { readFile, stat } from "fs/promises";
import { spawn } from "child_process";
import { join, relative } from "path";

interface SyncConfig {
  remote: string; // user@host:/path/to/dest
  localDir: string;
  excludeFrom?: string; // path to .gitignore
  debounceMs: number;
  verbose: boolean;
}

const DEFAULT_CONFIG: Partial<SyncConfig> = {
  localDir: process.cwd(),
  debounceMs: 300,
  verbose: false,
};

// Parse .gitignore and return patterns, filtering out .env entries
async function parseGitignore(gitignorePath: string): Promise<string[]> {
  try {
    const content = await readFile(gitignorePath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => {
        // Skip empty lines and comments
        if (!line || line.startsWith("#")) return false;
        // Skip .env patterns - we want to sync these
        if (line === ".env" || line.startsWith(".env")) return false;
        return true;
      });
  } catch {
    return [];
  }
}

// Build rsync command with appropriate flags
function buildRsyncCommand(
  config: SyncConfig,
  excludePatterns: string[]
): string[] {
  const args = [
    "-avz", // archive, verbose, compress
    "--delete", // remove files on dest that don't exist locally
    "--progress", // show progress
  ];

  // Add exclude patterns from gitignore (except .env)
  for (const pattern of excludePatterns) {
    args.push("--exclude", pattern);
  }

  // Always exclude .git directory
  args.push("--exclude", ".git");

  // Source (with trailing slash to sync contents)
  args.push(config.localDir.endsWith("/") ? config.localDir : `${config.localDir}/`);

  // Destination
  args.push(config.remote);

  return args;
}

// Execute rsync
function runRsync(args: string[], verbose: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("rsync", args, {
      stdio: verbose ? "inherit" : "pipe",
    });

    let stderr = "";
    if (!verbose && proc.stderr) {
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    proc.on("close", (code) => {
      if (code !== 0) {
        console.error(`rsync failed with code ${code}`);
        if (stderr) console.error(stderr);
        resolve(false);
      } else {
        resolve(true);
      }
    });

    proc.on("error", (err) => {
      console.error(`rsync error: ${err.message}`);
      resolve(false);
    });
  });
}

// Debounce function to batch rapid file changes
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  };
}

// Recursively get all directories to watch
async function getWatchDirs(
  dir: string,
  excludePatterns: string[]
): Promise<string[]> {
  const dirs: string[] = [dir];
  const entries = await Bun.file(dir).exists()
    ? []
    : await (async () => {
        try {
          const { readdir } = await import("fs/promises");
          return await readdir(dir, { withFileTypes: true });
        } catch {
          return [];
        }
      })();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    const fullPath = join(dir, name);
    const relPath = relative(dir, fullPath);

    // Skip if matches exclude pattern
    const shouldExclude = excludePatterns.some((pattern) => {
      // Simple glob matching
      if (pattern.endsWith("/")) {
        return name === pattern.slice(0, -1) || relPath === pattern.slice(0, -1);
      }
      if (pattern.includes("*")) {
        const regex = new RegExp(
          "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
        );
        return regex.test(name) || regex.test(relPath);
      }
      return name === pattern || relPath === pattern;
    });

    if (shouldExclude || name === ".git") continue;

    const subDirs = await getWatchDirs(fullPath, excludePatterns);
    dirs.push(...subDirs);
  }

  return dirs;
}

// Watch for file changes using fs.watch (recursive on supported platforms)
async function watchDirectory(
  config: SyncConfig,
  excludePatterns: string[],
  onSync: () => void
): Promise<void> {
  const debouncedSync = debounce(onSync, config.debounceMs);

  // Use recursive watch (supported on macOS, Windows, and Linux 5.9+)
  try {
    const watcher = watch(
      config.localDir,
      { recursive: true },
      (eventType, filename) => {
        if (!filename) return;

        // Skip .git changes
        if (filename.startsWith(".git/") || filename === ".git") return;

        // Check if file matches exclude patterns (but not .env)
        const shouldExclude = excludePatterns.some((pattern) => {
          if (pattern.endsWith("/")) {
            return filename.startsWith(pattern.slice(0, -1));
          }
          if (pattern.includes("*")) {
            const regex = new RegExp(
              "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
            );
            return regex.test(filename);
          }
          return filename === pattern || filename.startsWith(pattern + "/");
        });

        // Always sync .env files
        const isEnvFile = filename === ".env" || filename.endsWith("/.env");

        if (shouldExclude && !isEnvFile) {
          if (config.verbose) {
            console.log(`  [skip] ${filename} (gitignored)`);
          }
          return;
        }

        console.log(`  [${eventType}] ${filename}`);
        debouncedSync();
      }
    );

    process.on("SIGINT", () => {
      console.log("\nStopping sync...");
      watcher.close();
      process.exit(0);
    });

    console.log(`Watching ${config.localDir} for changes...`);
  } catch (err) {
    console.error("Watch error:", err);
    process.exit(1);
  }
}

// Main sync function
async function sync(config: SyncConfig): Promise<void> {
  const gitignorePath = join(config.localDir, ".gitignore");
  const excludePatterns = await parseGitignore(gitignorePath);

  // Always exclude these
  excludePatterns.push(".git");

  console.log(`Syncing ${config.localDir} → ${config.remote}`);
  if (config.verbose) {
    console.log("Exclude patterns:", excludePatterns);
  }

  const rsyncArgs = buildRsyncCommand(config, excludePatterns);

  // Initial sync
  console.log("\nRunning initial sync...");
  const success = await runRsync(rsyncArgs, config.verbose);

  if (!success) {
    console.error("Initial sync failed!");
    process.exit(1);
  }

  console.log("Initial sync complete!\n");

  // Start watching
  await watchDirectory(config, excludePatterns, async () => {
    console.log("\nSyncing changes...");
    const syncSuccess = await runRsync(rsyncArgs, config.verbose);
    if (syncSuccess) {
      console.log("Sync complete!");
    }
  });

  // Keep process alive
  await new Promise(() => {});
}

// CLI parsing
function printUsage(): void {
  console.log(`
Usage: bun sync <remote> [options]

Arguments:
  remote          Remote destination (user@host:/path/to/dest)

Options:
  -d, --dir       Local directory to sync (default: current directory)
  -v, --verbose   Show detailed output
  --debounce      Debounce interval in ms (default: 300)
  -h, --help      Show this help message

Examples:
  bun sync user@server:/home/user/project
  bun sync user@server:/app -d ./src --verbose
  bun sync root@192.168.1.100:/var/www/app --debounce 500

Note: .env files are always synced even if listed in .gitignore
`);
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(0);
  }

  const config: SyncConfig = {
    ...DEFAULT_CONFIG,
    remote: "",
    localDir: process.cwd(),
    debounceMs: 300,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-d" || arg === "--dir") {
      config.localDir = args[++i];
    } else if (arg === "-v" || arg === "--verbose") {
      config.verbose = true;
    } else if (arg === "--debounce") {
      config.debounceMs = parseInt(args[++i], 10);
    } else if (!arg.startsWith("-") && !config.remote) {
      config.remote = arg;
    }
  }

  if (!config.remote) {
    console.error("Error: remote destination is required");
    printUsage();
    process.exit(1);
  }

  // Validate local directory exists
  try {
    const stats = await stat(config.localDir);
    if (!stats.isDirectory()) {
      console.error(`Error: ${config.localDir} is not a directory`);
      process.exit(1);
    }
  } catch {
    console.error(`Error: ${config.localDir} does not exist`);
    process.exit(1);
  }

  await sync(config);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
