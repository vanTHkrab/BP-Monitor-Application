@AGENTS.md

# Web - Claude Context

This file provides guidance for AI-assisted changes in the web application.

## Project Summary

The `web/` project is a Next.js app using the App Router.

## Important Paths

- `src/app/`: Routes, layouts, and page-level composition
- `src/components/`: Shared app components and UI primitives
- `src/actions/`: Server actions
- `src/lib/`: Shared helpers and integrations
- `public/`: Static assets

## Commands

Run commands from `web/`:

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
```

## Working Rules For Claude

- Follow the rules defined in `AGENTS.md` before editing web code.
- Keep routing and page composition in `src/app/`.
- Prefer existing components and utilities before creating duplicates.
- Keep changes aligned with existing TypeScript and Next.js project patterns.
- Avoid unrelated refactors while implementing feature or fix requests.
