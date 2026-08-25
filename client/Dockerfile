# Client Dockerfile
ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
ARG NGINX_IMAGE=nginx:1.31.4-alpine@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913
FROM ${NODE_IMAGE} AS build

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

FROM ${NGINX_IMAGE}

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/wp-monitor/

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
