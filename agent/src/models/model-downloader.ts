import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { join } from "path";
import { logger } from "../utils/logger.js";

export class ModelDownloader {
  constructor(private modelsDir: string) {}

  async downloadModel(url: string, filename: string): Promise<string> {
    const modelPath = join(this.modelsDir, filename);

    logger.info({ url, filename, modelPath }, "Starting model download");

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const totalSize = parseInt(response.headers.get("content-length") || "0");
      let downloaded = 0;

      logger.info({ totalSize, filename }, "Download started");

      const fileStream = createWriteStream(modelPath);

      // Stream to file with progress tracking
      await pipeline(
        response.body!,
        async function* (source) {
          for await (const chunk of source) {
            downloaded += chunk.length;
            const percent =
              totalSize > 0 ? ((downloaded / totalSize) * 100).toFixed(2) : "0";

            // Log progress every 10%
            if (totalSize > 0 && downloaded % Math.floor(totalSize / 10) < chunk.length) {
              logger.info(
                { filename, downloaded, totalSize, percent },
                "Download progress"
              );
            }

            yield chunk;
          }
        },
        fileStream
      );

      logger.info({ filename, modelPath }, "Model downloaded successfully");
      return filename;
    } catch (error) {
      logger.error({ error, filename }, "Model download failed");
      throw error;
    }
  }
}
