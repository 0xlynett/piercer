import React from "react";
import { Box, Text } from "ink";
import type { ModelMapping } from "../types.js";

interface MappingsListProps {
  mappings: ModelMapping[];
}

export default function MappingsList({ mappings }: MappingsListProps) {
  if (mappings.length === 0) {
    return (
      <Box>
        <Text color="yellow">No model mappings configured</Text>
      </Box>
    );
  }

  // Calculate max widths for alignment
  const maxPublicNameLength = Math.max(
    ...mappings.map((m) => m.public_name.length),
    "Public Name".length
  );
  const maxInternalLength = Math.max(
    ...mappings.map((m) => m.internal_name.length),
    "Internal Name".length
  );

  return (
    <Box flexDirection="column">
      <Text color="blue" bold>
        Model Mappings ({mappings.length})
      </Text>
      <Box height={1} />

      {/* Header */}
      <Box>
        <Text color="gray">{"Public Name".padEnd(maxPublicNameLength)}</Text>
        <Text> </Text>
        <Text color="gray">→</Text>
        <Text> </Text>
        <Text color="gray">{"Internal Name".padEnd(maxInternalLength)}</Text>
      </Box>

      {/* Separator */}
      <Box>
        <Text color="gray">{"─".repeat(maxPublicNameLength)}</Text>
        <Text> </Text>
        <Text color="gray">→</Text>
        <Text> </Text>
        <Text color="gray">{"─".repeat(maxInternalLength)}</Text>
      </Box>

      {/* Mappings */}
      {mappings.map((mapping, index) => (
        <Box key={index}>
          <Text color="white">
            {mapping.public_name.padEnd(maxPublicNameLength)}
          </Text>
          <Text> </Text>
          <Text color="cyan">→</Text>
          <Text> </Text>
          <Text>{mapping.internal_name.padEnd(maxInternalLength)}</Text>
        </Box>
      ))}
    </Box>
  );
}
