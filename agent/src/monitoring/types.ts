export interface HardwareMetrics {
  type: "gpu" | "cpu";
  // GPU metrics (when nvidia-smi available)
  gpuUtilization?: number; // 0-100%
  gpuMemoryUsed?: number; // MB
  gpuMemoryTotal?: number; // MB
  gpuTemperature?: number; // Celsius
  // CPU/RAM metrics (fallback)
  ramUsed?: number; // MB
  ramTotal?: number; // MB
  cpuUtilization?: number; // 0-100% (average across cores)
}
