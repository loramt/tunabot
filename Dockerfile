FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    awscli \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY tsconfig.json drizzle.config.ts ./

# tsx and drizzle-kit needed at runtime
RUN npm install tsx drizzle-kit

COPY entrypoint.sh ./
USER node

ENTRYPOINT ["./entrypoint.sh"]
