# Build context is the REPOSITORY ROOT, not web/ — see infra/docker-compose.
#
# The docs site renders `docs/**/*.md` at build time, so `next build` needs
# that directory in scope. A context of `web/` cannot reach a sibling, and
# copying the Markdown into `web/` would create the second copy the whole
# design exists to avoid. Widening the context is the cheaper trade; the root
# `.dockerignore` keeps it from dragging in client/, server/, and node_modules.
#
# `docs/` lands at `/docs`, one level above WORKDIR, because `src/lib/docs.ts`
# resolves it relative to `process.cwd()`. Only the build stage needs it: the
# pages are prerendered, so the production image ships HTML and never reads
# Markdown at runtime.
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml* web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile || pnpm install

FROM base AS dev
COPY web/ ./
COPY docs/ /docs/
EXPOSE 3000
CMD ["pnpm", "dev"]

FROM base AS build
COPY web/ ./
COPY docs/ /docs/
RUN pnpm build

FROM node:24-alpine AS prod
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json /app/pnpm-lock.yaml* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["pnpm", "start"]
