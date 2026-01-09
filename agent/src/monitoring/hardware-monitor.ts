import { spawn } from "child_process";
import { parseStringPromise } from "xml2js";
import * as os from "os";
import { logger } from "../utils/logger.js";
import type { HardwareMetrics } from "./types.js";

export class HardwareMonitor {
  private hasGPU: boolean = false;
  private lastMetrics: HardwareMetrics | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastCPUInfo = os.cpus();
  private lastCPUTimes = this.getCPUTimes();

  async initialize(): Promise<void> {
    // Detect if nvidia-smi is available
    this.hasGPU = await this.detectGPU();
    logger.info({ hasGPU: this.hasGPU }, "Hardware monitor initialized");
  }

  async detectGPU(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn("nvidia-smi", ["--version"]);

      process.on("error", () => {
        logger.info("nvidia-smi not found, using CPU/RAM monitoring");
        resolve(false);
      });

      process.on("close", (code) => {
        if (code === 0) {
          logger.info("nvidia-smi detected, using GPU monitoring");
          resolve(true);
        } else {
          resolve(false);
        }
      });

      // Timeout after 2 seconds
      setTimeout(() => {
        process.kill();
        resolve(false);
      }, 2000);
    });
  }

  startMonitoring(intervalMs: number = 5000): void {
    if (this.pollingInterval) {
      return; // Already monitoring
    }

    // Initial collection
    this.collectMetrics();

    this.pollingInterval = setInterval(() => {
      this.collectMetrics();
    }, intervalMs);

    logger.info({ intervalMs }, "Started hardware monitoring");
  }

  stopMonitoring(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logger.info("Stopped hardware monitoring");
    }
  }

  getLastMetrics(): HardwareMetrics | null {
    return this.lastMetrics;
  }

  private async collectMetrics(): Promise<void> {
    try {
      if (this.hasGPU) {
        this.lastMetrics = await this.collectGPUMetrics();
      } else {
        this.lastMetrics = await this.collectCPUMetrics();
      }
    } catch (error) {
      logger.error({ error }, "Failed to collect hardware metrics");
    }
  }

  private async collectGPUMetrics(): Promise<HardwareMetrics> {
    return new Promise((resolve, reject) => {
      const process = spawn("nvidia-smi", ["-q", "-x"]);
      let xmlData = "";

      process.stdout.on("data", (data) => {
        xmlData += data.toString();
      });

      process.stderr.on("data", (data) => {
        logger.error({ stderr: data.toString() }, "nvidia-smi stderr");
      });

      process.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`nvidia-smi exited with code ${code}`));
          return;
        }

        try {
          const parsed = await parseStringPromise(xmlData);
          const gpu = parsed.nvidia_smi_log.gpu[0];

          const metrics: HardwareMetrics = {
            type: "gpu",
            gpuUtilization: parseInt(
              gpu.utilization[0].gpu_util[0].replace("%", "")
            ),
            gpuMemoryUsed: parseInt(
              gpu.fb_memory_usage[0].used[0].replace(" MiB", "")
            ),
            gpuMemoryTotal: parseInt(
              gpu.fb_memory_usage[0].total[0].replace(" MiB", "")
            ),
            gpuTemperature: parseInt(
              gpu.temperature[0].gpu_temp[0].replace(" C", "")
            ),
          };

          resolve(metrics);
        } catch (err) {
          reject(err);
        }
      });

      process.on("error", (err) => {
        reject(err);
      });
    });
  }

  private async collectCPUMetrics(): Promise<HardwareMetrics> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Calculate CPU utilization
    const cpuUtil = this.calculateCPUUtilization();

    return {
      type: "cpu",
      ramUsed: Math.round(usedMem / 1024 / 1024), // Convert to MB
      ramTotal: Math.round(totalMem / 1024 / 1024),
      cpuUtilization: cpuUtil,
    };
  }

  private getCPUTimes() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += cpu.times[type as keyof typeof cpu.times];
      }
      idle += cpu.times.idle;
    }

    return { idle, total };
  }

  private calculateCPUUtilization(): number {
    const current = this.getCPUTimes();
    const idleDiff = current.idle - this.lastCPUTimes.idle;
    const totalDiff = current.total - this.lastCPUTimes.total;

    this.lastCPUTimes = current;

    if (totalDiff === 0) {
      return 0;
    }

    const utilization = 100 - (100 * idleDiff) / totalDiff;
    return Math.round(utilization);
  }

  /**
   * Get available memory for model loading
   * Returns available VRAM (GPU) or RAM (CPU) in MB
   */
  getAvailableMemory(): number {
    if (!this.lastMetrics) {
      return 0;
    }

    if (this.lastMetrics.type === "gpu" && this.lastMetrics.gpuMemoryTotal) {
      const used = this.lastMetrics.gpuMemoryUsed || 0;
      const total = this.lastMetrics.gpuMemoryTotal;
      return total - used;
    } else if (this.lastMetrics.type === "cpu" && this.lastMetrics.ramTotal) {
      const used = this.lastMetrics.ramUsed || 0;
      const total = this.lastMetrics.ramTotal;
      return total - used;
    }

    return 0;
  }
}
