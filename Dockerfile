FROM node:22-slim

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY tsconfig.json drizzle.config.ts ./

# tsx and drizzle-kit needed at runtime
RUN npm install tsx drizzle-kit

USER node

CMD ["sh", "-c", "npx drizzle-kit push && npx tsx src/index.ts"]
