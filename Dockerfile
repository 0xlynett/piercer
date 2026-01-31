FROM vastai/base-image

# Install Node.js (required for agent)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Bun (required for controller and cli)
RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY agent/package.json ./agent/
COPY cli/package.json ./cli/
COPY controller/package.json ./controller/
COPY rpc/package.json ./rpc/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code (excluding db files and data directories)
COPY agent ./agent
COPY cli ./cli
COPY controller ./controller
COPY rpc ./rpc
COPY tsconfig.json ./

# Create necessary directories for runtime
RUN mkdir -p /app/models /app/data

# Environment variable to control which mode to run
ENV MODE=cli

# Entrypoint script to run the appropriate service
COPY <<'EOF' /entrypoint.sh
#!/bin/bash
set -e

case "$MODE" in
  agent)
    echo "Starting Piercer Agent..."
    exec node --env-file=.env --import tsx/esm agent
    ;;
  controller)
    echo "Starting Piercer Controller..."
    exec bun ./controller
    ;;
  cli)
    echo "Starting Piercer CLI..."
    exec bun run ./cli/src/index.tsx "$@"
    ;;
  *)
    echo "Invalid MODE: $MODE. Valid options are: agent, cli, controller"
    exit 1
    ;;
esac
EOF

RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
