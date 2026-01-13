import React from "react";
import { Box, Text } from "ink";
import type { Agent } from "../types.js";

interface AgentsListProps {
  agents: Agent[];
}

export default function AgentsList({ agents }: AgentsListProps) {
  if (agents.length === 0) {
    return (
      <Box>
        <Text color="yellow">No agents connected</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="blue" bold>
        Connected Agents ({agents.length})
      </Text>
      <Box height={1} />

      {agents.map((agent) => (
        <Box
          key={agent.id}
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={2}
          paddingY={1}
          marginBottom={1}
        >
          {/* Agent header */}
          <Box>
            <Text bold color="magenta">
              ID:
            </Text>
            <Text> </Text>
            <Text color="white">{agent.id}</Text>
            <Text> </Text>
            <Text color="yellow">({agent.name})</Text>
          </Box>

          {/* Loaded models */}
          <Box marginLeft={2}>
            <Text color="white">Loaded: </Text>
            {(agent.loadedModels?.length ?? 0) > 0 ? (
              <Text color="green">{agent.loadedModels?.join(", ")}</Text>
            ) : (
              <Text color="gray">none</Text>
            )}
          </Box>

          {/* Installed models */}
          <Box marginLeft={2}>
            <Text color="white">Installed: </Text>
            {(agent.installedModels?.length ?? 0) > 0 ? (
              <Text>{agent.installedModels?.join(", ")}</Text>
            ) : (
              <Text color="gray">none</Text>
            )}
          </Box>

          {/* Pending requests */}
          <Box marginLeft={2}>
            <Text color="white">Pending requests: </Text>
            <Text color={agent.pendingRequests > 0 ? "yellow" : "green"}>
              {agent.pendingRequests}
            </Text>
          </Box>

          {/* Status and VRAM if available */}
          {agent.status && (
            <Box marginLeft={2}>
              <Text color="white">Status: </Text>
              <Text
                color={
                  agent.status === "healthy"
                    ? "green"
                    : agent.status === "busy"
                    ? "yellow"
                    : "red"
                }
              >
                {agent.status}
              </Text>
            </Box>
          )}

          {agent.vram_used !== undefined && agent.vram_total !== undefined && (
            <Box marginLeft={2}>
              <Text color="white">VRAM: </Text>
              <Text>
                {Math.round(agent.vram_used / 1024 / 1024 / 1024)}GB /{" "}
                {Math.round(agent.vram_total / 1024 / 1024 / 1024)}GB
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
