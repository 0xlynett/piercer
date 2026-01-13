import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

interface ProgressBarProps {
  percent: number;
  width?: number;
  color?: "green" | "blue" | "yellow" | "red" | "cyan" | "magenta";
  showPercent?: boolean;
  label?: string;
}

export default function ProgressBar({
  percent,
  width = 40,
  color = "green",
  showPercent = true,
  label,
}: ProgressBarProps) {
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const filledWidth = Math.round((clampedPercent / 100) * width);
  const emptyWidth = width - filledWidth;

  const filledChar = "█";
  const emptyChar = "░";

  const colorMap = {
    green: "\x1b[32m",
    blue: "\x1b[34m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
  };

  return (
    <Box>
      {label && (
        <Text>
          {label}
          <Text> </Text>
        </Text>
      )}
      <Text>
        <Text color={color}>{filledChar.repeat(filledWidth)}</Text>
        {emptyChar.repeat(emptyWidth)}
      </Text>
      {showPercent && (
        <Text>
          <Text> </Text>
          <Text color="gray">{Math.round(clampedPercent)}%</Text>
        </Text>
      )}
    </Box>
  );
}

interface DownloadProgressProps {
  downloaded: number;
  total: number;
  speed?: string;
  label?: string;
}

export function DownloadProgress({
  downloaded,
  total,
  speed,
  label = "Downloading",
}: DownloadProgressProps) {
  const percent = total > 0 ? (downloaded / total) * 100 : 0;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="blue" bold>
          {label}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <ProgressBar
          percent={percent}
          width={40}
          color="green"
          showPercent={true}
        />
      </Box>
      <Box marginLeft={2}>
        <Text color="gray">
          {formatBytes(downloaded)} / {formatBytes(total)}
        </Text>
        {speed && (
          <Text color="gray">
            <Text> </Text>({formatBytes(parseInt(speed))}/s)
          </Text>
        )}
      </Box>
    </Box>
  );
}

// Animated spinner component
interface SpinnerProps {
  text?: string;
  color?: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({
  text = "Loading...",
  color = "green",
}: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f: number) => (f + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text color={color}>
      {SPINNER_FRAMES[frame]} {text}
    </Text>
  );
}
