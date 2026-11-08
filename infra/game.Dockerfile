# The friend-room game server (packages/game) with the rules it runs (packages/sim) and the game data they read.
FROM node:22-bookworm-slim
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
RUN mkdir -p /data/replays && chown -R node:node /data
USER node
ENV HOST=0.0.0.0 PORT=8787 REPLAY_DIR=/data/replays
EXPOSE 8787
CMD ["node_modules/.bin/vite-node", "packages/game/src/main.ts"]
