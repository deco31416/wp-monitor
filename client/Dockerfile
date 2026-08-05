# Client Dockerfile
FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache git python3 make g++
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json

RUN pnpm install --frozen-lockfile --filter @deco31416/wp-monitor-client...

COPY client/public ./client/public
COPY client/src ./client/src
COPY client/tsconfig.json ./client/tsconfig.json
COPY client/tailwind.config.js ./client/tailwind.config.js
COPY client/postcss.config.js ./client/postcss.config.js

ARG REACT_APP_API_URL=http://localhost:4000
ENV REACT_APP_API_URL=${REACT_APP_API_URL}

WORKDIR /app/client
RUN pnpm run build

FROM nginx:alpine

COPY client/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/client/build /usr/share/nginx/html

ARG PORT=4001
ENV PORT=${PORT}
EXPOSE ${PORT}

CMD sed -i "s/listen 80;/listen ${PORT};/g" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'
