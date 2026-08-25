# Client Dockerfile
ARG NODE_VERSION=24.19.0
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json
COPY patches ./patches
COPY scripts/verify-node-version.mjs ./scripts/verify-node-version.mjs

# The shared lockfile contains the native backend `cap` dependency. The static
# frontend does not execute dependency lifecycle scripts; Vite/Rolldown use
# their lockfile-selected platform packages directly.
RUN node scripts/verify-node-version.mjs \
    && pnpm install --frozen-lockfile --ignore-scripts --filter @deco31416/wp-monitor-client...

COPY client/public ./client/public
COPY client/src ./client/src
COPY client/index.html ./client/index.html
COPY client/tsconfig.json ./client/tsconfig.json
COPY client/vite.config.mts ./client/vite.config.mts
COPY client/tailwind.config.js ./client/tailwind.config.js
COPY client/postcss.config.js ./client/postcss.config.js

ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=${VITE_API_URL}

WORKDIR /app/client
RUN pnpm run build

FROM nginx:alpine

COPY client/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/client/build /usr/share/nginx/html

ARG PORT=4001
ENV PORT=${PORT}
EXPOSE ${PORT}

RUN sed -i "s/listen 80;/listen ${PORT};/g" /etc/nginx/conf.d/default.conf \
    && sed -i '/^[[:space:]]*user /d' /etc/nginx/nginx.conf \
    && sed -i 's!^[[:space:]]*pid .*;!pid /tmp/nginx.pid;!' /etc/nginx/nginx.conf \
    && chown -R nginx:nginx /var/cache/nginx

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider "http://127.0.0.1:${PORT}/healthz" || exit 1

USER nginx

CMD ["nginx", "-g", "daemon off;"]
