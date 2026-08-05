# Backend Dockerfile
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git python3 make g++ libpcap-dev linux-headers
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json
COPY tsconfig.json ./

RUN pnpm install --frozen-lockfile --filter @deco31416/wp-monitor...

COPY src ./src
COPY public ./public

RUN pnpm run build

ARG PORT=4000
ENV PORT=${PORT}
EXPOSE ${PORT}

RUN mkdir -p /app/auth_info_baileys

CMD ["node", "dist/server.js"]
