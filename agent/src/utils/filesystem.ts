import { readdir, readFile, writeFile, stat, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync, watch } from "fs";

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDirExists(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Get list of all model files in the models directory
 * Filesystem is the source of truth - no database needed
 */
export async function listInstalledModels(
  modelsDir: string
): Promise<string[]> {
  try {
    if (!existsSync(modelsDir)) {
      return [];
    }

    const files = await readdir(modelsDir);
    // Filter for GGUF files (common llama.cpp format)
    return files.filter((f) => f.endsWith(".gguf") || f.endsWith(".ggml"));
  } catch (error) {
    console.error("Error listing models:", error);
    return [];
  }
}

/**
 * Get full path to a model file
 */
export function getModelPath(modelsDir: string, modelName: string): string {
  return join(modelsDir, modelName);
}

/**
 * Check if a model file exists
 */
export async function modelExists(
  modelsDir: string,
  modelName: string
): Promise<boolean> {
  const modelPath = getModelPath(modelsDir, modelName);
  return existsSync(modelPath);
}

/**
 * Get model file size in bytes
 */
export async function getModelSize(
  modelsDir: string,
  modelName: string
): Promise<number> {
  const modelPath = getModelPath(modelsDir, modelName);
  const stats = await stat(modelPath);
  return stats.size;
}

/**
 * Load agent ID from file, or generate new one
 */
export async function loadOrGenerateAgentId(dataDir: string): Promise<string> {
  // Ensure data directory exists
  await ensureDirExists(dataDir);

  const idPath = join(dataDir, "agent-id.txt");

  try {
    if (existsSync(idPath)) {
      const id = await readFile(idPath, "utf-8");
      return id.trim();
    }
  } catch (error) {
    // File doesn't exist or can't be read, generate new ID
  }

  // Generate new agent ID
  const newId = "agent-" + Math.random().toString(36).substring(2, 15);
  await writeFile(idPath, newId, "utf-8");
  return newId;
}

/**
 * Watch models folder for additions, deletions, and renames
 * Returns a cleanup function to stop watching
 */
export function watchModelsFolder(
  modelsDir: string,
  onChange: (models: string[]) => void
): () => void {
  const getModels = async (): Promise<string[]> => {
    try {
      if (!existsSync(modelsDir)) {
        return [];
      }
      const files = await readdir(modelsDir);
      return files.filter((f) => f.endsWith(".gguf") || f.endsWith(".ggml"));
    } catch {
      return [];
    }
  };

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(modelsDir, (eventType, filename) => {
    // Ignore events for non-model files
    if (
      filename &&
      typeof filename === "string" &&
      !filename.endsWith(".gguf") &&
      !filename.endsWith(".ggml")
    ) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      const models = await getModels();
      onChange(models);
    }, 100);
  });

  // Initial load - notify with current models
  getModels().then(onChange);

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    watcher.close();
  };
}
