# VoiceForge orchestrator. Build context = repo root:  fly deploy  (uses fly.toml at the root)
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    # Skip optional CUDA downloads for onnxruntime-node (CPU Silero VAD only).
    ONNXRUNTIME_NODE_INSTALL=skip

# Install only the orchestrator + shared workspaces (no Next.js).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/orchestrator/package.json apps/orchestrator/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @voiceforge/orchestrator -w @voiceforge/shared --include-workspace-root=false \
    && npm cache clean --force

COPY packages/shared/src packages/shared/src
COPY apps/orchestrator/src apps/orchestrator/src
COPY apps/orchestrator/agents apps/orchestrator/agents
COPY apps/orchestrator/models apps/orchestrator/models

ENV ORCHESTRATOR_PORT=8080 \
    DATA_DIR=/data
EXPOSE 8080
# Runs as root: Fly volumes mount root-owned at /data.
CMD ["node", "--import", "tsx", "apps/orchestrator/src/index.ts"]
