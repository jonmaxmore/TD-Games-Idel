# The friend-room game server (packages/game), bundled by esbuild with the rules it runs (packages/sim) and the game
# data they read (docs/data, inlined). The runtime image holds the bundle and the server's production dependencies only.
# Base pinned by tag and by the multi-arch digest Docker Hub lists for it (2026-11-05).
ARG NODE=node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

FROM ${NODE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/protocol/package.json packages/protocol/
COPY packages/game/package.json packages/game/
COPY packages/client/package.json packages/client/
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY docs/data docs/data
COPY packages/sim packages/sim
COPY packages/protocol packages/protocol
COPY packages/game packages/game
RUN npm run build:server

FROM ${NODE}
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/protocol/package.json packages/protocol/
COPY packages/game/package.json packages/game/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev -w @five-sects/game --no-audit --no-fund --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist/game/main.mjs server.mjs
RUN mkdir -p /data/replays && chown -R node:node /data
USER node
ENV HOST=0.0.0.0 PORT=8787 REPLAY_DIR=/data/replays
EXPOSE 8787
CMD ["node", "server.mjs"]
