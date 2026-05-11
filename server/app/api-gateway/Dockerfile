FROM node:24-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM base AS dev
COPY . .
CMD ["pnpm", "start:dev"]

FROM base AS prod
COPY . .
RUN pnpm build
CMD ["pnpm", "start:prod"]