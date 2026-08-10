FROM node:24-alpine AS base
WORKDIR /app
# pnpm-workspace.yaml is NOT optional here, despite this not being a workspace.
# pnpm 10 moved `overrides` and `allowBuilds` out of package.json into that
# file, and this project uses both — `overrides` pins handlebars past a
# prototype-pollution advisory. The lockfile records the overrides it was
# resolved with, so building without the file makes pnpm see an empty override
# config, compare it against the lockfile's, and abort with
# ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Nothing about that error names the missing
# file. web/Dockerfile already copies its own copy for the same reason.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM base AS dev
COPY . .
CMD ["pnpm", "start:dev"]

FROM base AS prod
COPY . .
RUN pnpm build
CMD ["pnpm", "start:prod"]