# Backend Dockerfile
ARG NODE_VERSION=24.19.0
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ libpcap-dev \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json
COPY patches ./patches
COPY scripts/verify-node-version.mjs ./scripts/verify-node-version.mjs
COPY tsconfig.json ./

RUN pnpm install --frozen-lockfile --filter @deco31416/wp-monitor...

COPY src ./src
COPY public ./public

RUN pnpm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libpcap0.8 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

ARG PORT=4000
ENV PORT=${PORT}
EXPOSE ${PORT}

RUN mkdir -p /app/auth_info_baileys /app/public/uploads \
    && chown -R node:node /app/auth_info_baileys /app/public/uploads

USER node

CMD ["node", "dist/server.js"]
