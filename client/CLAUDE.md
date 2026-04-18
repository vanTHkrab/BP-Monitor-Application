# Client (Mobile) - Claude Context

This file provides guidance for AI-assisted changes in the mobile app.

## Project Summary

The `client/` project is an Expo + React Native app using Expo Router.

## Important Paths

- `app/`: Route screens and layouts (file-based routing)
- `components/`: Shared UI components
- `store/`: Global app state (Zustand)
- `data/`: Local data access and mock data
- `utils/`: Utility helpers (export/reminder/font helpers)
- `types/`: Shared TypeScript types

## Commands

Run commands from `client/`:

```bash
pnpm install
pnpm start
pnpm lint
pnpm android
pnpm ios
```

## Working Rules For Claude

- Keep route-level UI and navigation logic inside `app/`.
- Reuse existing shared components from `components/` before creating new ones.
- Preserve cross-platform behavior for iOS, Android, and Expo web.
- Keep state changes aligned with existing patterns in `store/useAppStore.ts`.
- Prefer small, focused changes that do not refactor unrelated screens.
