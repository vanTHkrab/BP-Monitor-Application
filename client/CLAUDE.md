# Client (Mobile) — Claude Context

This file provides guidance for AI-assisted changes in the mobile app.
It supplements the root `CLAUDE.md` and the human-facing `README.md`.

## Project Summary

Expo SDK 54 + React Native 0.81 patient app. Expo Router file-based routing.
Single Zustand store. Offline-first reading capture with SQLite queue. Token
auth against the NestJS gateway via GraphQL. Source lives under `src/` with
the route layer (`app/`) and shared components (`components/`) at the
project root because Expo Router and the `@/` alias both resolve from there.

## Run Commands

From `client/`:

```bash
pnpm install
pnpm start                  # Expo dev server (works for both Expo Go and dev client)
pnpm android | pnpm ios     # builds + installs the custom dev client (needed for MMKV, vision modules, etc.)
pnpm web                    # web preview (limited — MMKV uses its localStorage shim, SecureStore isn't available)
pnpm lint
pnpm exec tsc --noEmit -p . # type-check (no test runner is configured)
pnpm expo install --check   # audit deps against the SDK's bundled native versions
```

## Layered Structure

The project distinguishes three layers, each with its own folder:

```text
src/
├── core/        # Infrastructure. App-agnostic. Knows about env, storage, transport, errors.
│   ├── config/      env.ts + constants.ts
│   ├── graphql/     client.ts + operations.ts + errors.ts
│   ├── storage/     mmkv.storage.ts + secure.storage.ts + storage.keys.ts
│   └── auth/        session.ts (session-expired notification primitive)
├── store/       # Domain state. Zustand slices that own user/readings/posts/etc.
├── services/    # Stateful workflows over remote systems (e.g. AI image pipeline).
├── lib/ utils/  # Pure helpers and SDK wrappers — see "lib/ vs services/" below.
└── data/        # SQLite schema + helpers (the offline mirror).
```

The `app/` (routes) and `components/` (UI primitives) live at the project
root, NOT under `src/`, because Expo Router conventions and the `@/`
TypeScript alias both target the client root.

## Important Paths

| Path | Responsibility |
| --- | --- |
| `app/` | Route screens (Expo Router file-based). All navigation lives here. |
| `app/(tabs)/` | The bottom-tab navigator. Tab bar in `_layout.tsx`. |
| `components/` | Cross-screen UI primitives. Reuse before adding. |
| `components/ui/avatar.tsx`, `components/ui/image.tsx` | UI primitives. `UIImage` wraps `expo-image` with NativeWind className, internal error state, and a fallback slot. `Avatar` composes it with initials / Ionicons fallback and xs–xl sizes. Use these instead of `<Image>` from `react-native`. |
| `src/core/config/env.ts` | Single source of truth for environment-derived config. Reads `process.env.EXPO_PUBLIC_*` and `Constants.expoConfig.extra` once, validates with zod, and exports a typed `env` object. Throws at module load if config is invalid. |
| `src/core/config/constants.ts` | Environment-independent infrastructure tunables: `REQUEST_TIMEOUT_MS`, `IMAGE_CACHE_TTL_MS`, `AI_POLL_INTERVAL_MS`/`AI_POLL_TIMEOUT_MS`, and the `GQL_ERROR_CODES` string union. NOT for domain knowledge (BP thresholds belong in `constants/colors.ts`) or feature-local constants. |
| `src/core/graphql/client.ts` | Unified GraphQL transport. Exposes `graphqlRequest` (JSON, explicit token, 30s timeout), `gqlRequest` (JSON, auto-fetches token), and `gqlUpload` (multipart). All three share the 401 fan-out via `core/auth/session`. |
| `src/core/graphql/operations.ts` | Every `GQL_*` query/mutation string the client sends, grouped by domain (Auth, Image, Readings, Posts, Comments, Alerts, Caregivers, Debug). |
| `src/core/graphql/errors.ts` | `GraphQLClientError` class — typed error thrown by the transports carrying `code` (server's `extensions.code`), `httpStatus`, and `retryAfterSec` — plus `errorCode` / `errorHttpStatus` / `errorRetryAfterSec` / `isGraphQLClientError` helpers. |
| `src/core/storage/mmkv.storage.ts` | Async KV facade. Uses `react-native-mmkv` when the native binding is linked (custom dev client, EAS build, web shim) and transparently falls back to AsyncStorage in Expo Go. Exposes `kvStorage.{getString,setString,delete,has,getAllKeys,getJSON,setJSON}` and an `isMMKVAvailable` flag for diagnostics. |
| `src/core/storage/secure.storage.ts` | Async facade around `expo-secure-store` (`secureStorage.{get,set,delete}`). Use for credentials only — anything non-sensitive belongs in `mmkv.storage.ts`. Native-only; web is unsupported by design. |
| `src/core/storage/storage.keys.ts` | Every persistent key the app writes — `SECURE_KEYS` for credentials, `KV_KEYS` for preferences, `userKey.*` for per-user computed keys. One file lets you grep the whole storage surface; renaming a key forces touching it, so migrations stay deliberate. |
| `src/core/auth/session.ts` | Session-expired notification primitive: `setUnauthenticatedHandler` (auth slice registers a handler at bootstrap) + `fireUnauthenticated` (transports call this on 401 / UNAUTHENTICATED). Module-level state — never import the store from here. |
| `src/constants/api.ts` | Endpoint accessors (`getApiBaseUrl`, `getGraphqlEndpoint`) + token helpers (`setAuthToken`, `getAuthToken`, `clearAuthToken`) that compose `secureStorage`. Operation strings and transport now live in `core/graphql/`. |
| `src/constants/colors.ts` | BP-status thresholds + Tailwind color tokens. |
| `src/data/local-db.ts` | SQLite schema + helpers. `pending_readings` is both the offline queue **and** the mirror of synced readings (rows carry a `syncStatus` of `pending` / `pending-image` / `synced` and a `remoteId` once confirmed); `cached_images` tracks 7-day-cached image files keyed by extracted S3 path. |
| `src/hooks/use-camera-analysis.ts` | State machine for BP image capture → AI analysis → save. `save()` delegates to `readings.slice.createReading` so the camera flow inherits the offline queue and optimistic UI used by manual entry. |
| `src/hooks/use-resolved-image-uri.ts` | React hook over `image-cache` — feeds remote URI on mount, swaps to the `file://` once `resolveImageUri` returns. Used by `reading-detail-modal` so signed-URL rotation is transparent and history images render offline. |
| `src/lib/error-message.ts` | General `formatError(error)` — hides raw English in production, surfaces it as `devDetail` in `__DEV__`. Use this for non-auth flows. |
| `src/services/camera.service.ts` | `analyzeImage`: presigned upload + enqueue AI + poll. Returns `uploadedUrl` so the caller can hand it to `createReading` without re-uploading. Reading persistence itself lives in the store, not here. Polling defaults come from `core/config/constants.ts`. |
| `src/store/use-app-store.ts` | Composer for the single Zustand store. Imports and merges every slice — keep slim. |
| `src/store/slices/` | Domain slices: `auth` (+ sessions), `profile` (me + avatar queue), `readings` (+ alerts), `community` (posts + comments), `caregivers`, `preferences` (theme + font + security), `network`. |
| `src/store/shared/` | Cross-slice helpers: `log` (`logWarn`, `communityDebug`), `client-id` (local-id helpers + `createClientId`), `error-format` (`formatAuthError` for login/register UX + legacy `authErrorToThai`), `mappers` (`xxxFromGql` + sorters). |
| `src/types/` | Shared TypeScript types. Add domain types here, not inline. |
| `src/utils/` | `export-data` (CSV/PDF), `reminders`, `font-scale`, `upload-image`, `phone-format` (Thai phone formatter + `stripPhoneDigits`), `image-prepare` (resize + recompress images before they hit the AI / S3 path), `image-cache` (`resolveImageUri` / `cleanupExpiredImages` — downloads signed S3 images into `Paths.cache` keyed by extracted S3 path; TTL from `core/config/constants.ts`). |

## Architectural Conventions

- **One store, multiple slices**: there is exactly one Zustand store
  (`useAppStore`). It is composed from slice files under `src/store/slices/`
  using Zustand's slice pattern — each slice is a `StateCreator<AppState,
  [], [], MySlice>` so cross-slice `get()` is fully typed and `set()` can
  update fields from any slice atomically. Don't introduce a second
  Zustand store or a context-based state holder. Add new state/actions to
  the slice they belong to; if a new domain doesn't fit any slice, create a
  new `xxx.slice.ts` and wire it into [src/store/use-app-store.ts](./src/store/use-app-store.ts).
- **Optimistic UI**: writes update the store first, then either succeed
  remotely (no extra work) or fall back to the SQLite queue. Reads reconcile
  on the next `fetchX` call.
- **Sync mutex**: `syncPendingReadings` and `syncPendingPosts` use a
  promise-based mutex (`syncReadingsPromise` / `syncPostsPromise`).
  Concurrent callers should `return` the in-flight promise — never replace it
  with a boolean flag.
- **Error visibility**: catch blocks in store actions should call
  `logWarn(scope, message, error, details?)`. It's `__DEV__`-guarded so it
  stays out of production logs. Don't add bare `catch {}`.
- **User-facing errors are inline, not Alert**: for forms (login, register,
  any future input flow), surface validation and server errors via
  `CustomInput.error` (inline under the field) or a banner above the form —
  not `Alert.alert`. Reserve Alert for permission prompts (camera, photo
  library) and one-shot confirmations (logout, delete). Never leak the
  server's `extensions.code` or raw English `message` into a dialog. For
  login/register, run the thrown `GraphQLClientError` through
  `formatAuthError(error, { context })` which returns
  `{ message, field, retryAfterSec }` — dispatch `message` to the right
  field via `authErrorField` and show a deadline-based countdown when
  `authErrorRetryAfterSec` is set (HTTP 429 from login throttle).
- **Environment variables**: never read `process.env.*` or
  `Constants.expoConfig.extra` directly from feature code. Import the
  typed `env` from `src/core/config/env.ts` instead. To add a new env var,
  extend the zod schema in `env.ts` (with a default if optional), wire
  it into `resolveRaw()`, and document it in `.env.example`. The schema
  is the contract — `process.env.EXPO_PUBLIC_*` reads scattered through
  slices/utils are a regression.
- **Storage layer**: every persistent write goes through one of two
  facades. Credentials (tokens, biometric salts) use `secureStorage` from
  `src/core/storage/secure.storage.ts`. Everything else (preferences,
  per-user JSON, cache flags) uses `kvStorage` from
  `src/core/storage/mmkv.storage.ts` — async API that picks MMKV when the
  native binding is linked and falls back to AsyncStorage in Expo Go.
  Never import `expo-secure-store` or `@react-native-async-storage/async-storage`
  directly from feature code. Every key goes in
  `src/core/storage/storage.keys.ts` (no ad-hoc string literals at call sites).
- **Auth token**: always go through `setAuthToken` / `getAuthToken` /
  `clearAuthToken` from `src/constants/api.ts` — they wrap `secureStorage`
  with the `SECURE_KEYS.AUTH_TOKEN` key. Never read or write the token
  directly.
- **Session-expired auto-logout**: all three GraphQL transports in
  `src/core/graphql/client.ts` (`graphqlRequest`, `gqlRequest`, `gqlUpload`)
  call `fireUnauthenticated()` from `src/core/auth/session.ts` when the
  server returns HTTP 401 or `extensions.code === 'UNAUTHENTICATED'` on a
  **token-bearing** request. The auth slice registers the handler via
  `setUnauthenticatedHandler` at store-composition time; it dispatches to
  `handleSessionExpired()` which idempotently clears local state and
  shows a Thai banner on the login screen. Don't re-implement 401
  handling in individual slices — let the transport fire and the slice
  action will run once. New GraphQL transports MUST call
  `fireUnauthenticated()` on the same conditions, or session revocation
  from another device won't propagate.
- **GraphQL error codes**: comparison sites use the `GQL_ERROR_CODES`
  string-literal union from `src/core/config/constants.ts`
  (`GQL_ERROR_CODES.UNAUTHENTICATED`, etc.) — not bare string literals.
  When the gateway introduces a new `extensions.code`, add it to the
  union in the same change as the consumer. The wire type stays
  `string | null` on `GraphQLClientError.code` so unknown codes don't
  type-error, but every value the client actively branches on must be
  in the union.
- **Client IDs for offline records** must come from `createClientId(prefix,
  userId)`. It combines timestamp + 120 bits of randomness. Don't generate
  IDs ad-hoc with `Math.random().slice(...)`.
- **Image uploads**: BP images use the multipart path in
  `src/services/camera.service.ts`; avatars and other one-shot uploads use
  `src/utils/upload-image.ts → uploadImageViaPresign`. Both paths share the
  same wire flow (presign → PUT → confirm) but **must not** use
  `new Blob([Uint8Array])` for the PUT body — RN's Blob refuses
  ArrayBuffer/Uint8Array at runtime even though the TS types accept it.
  On native, stream the file with `FileSystem.uploadAsync` from
  `expo-file-system/legacy` (`uploadType: BINARY_CONTENT`); the
  fetch+Blob path is web-only.
- **Local-only IDs are strings prefixed with `local-` (readings) or
  `local-post-` (posts)**. Use the `isLocalReadingId`/`isLocalPostId` helpers
  in the store; don't string-match these prefixes elsewhere.
- **`core/` vs `lib/` vs `services/` vs `utils/` vs `hooks/`** — pick the
  bucket by what the file *is*, not what it touches.
  - `core/` is infrastructure that the rest of the app depends on
    (env, storage, transport, errors, session primitive). Feature code
    is forbidden here.
  - `services/` is for stateful I/O modules that own a workflow against
    a remote system (e.g. `camera.service.ts` owns upload + poll for
    AI analysis).
  - `lib/` is a residual category for low-level integrations that aren't
    `core/` yet — today only `error-message.ts` lives here; new infra
    should go in `core/`.
  - `utils/` is pure functions and small side-effect helpers that don't
    model a remote workflow (CSV/PDF export, font scaling, one-shot S3
    uploads, local notification scheduling).
  - `hooks/` is React hooks only — anything returning a hook must live
    here, anything not must not.
  - When in doubt: infrastructure → `core/`, workflow → `services/`,
    helper → `utils/`, React state → `hooks/`.

## Styling Conventions

- NativeWind (Tailwind classes via `className`). Don't use raw `StyleSheet`
  unless interop demands it.
- Dark mode is driven by `themePreference` from the store, not by the
  device's `useColorScheme()`. Read `s.themePreference === 'dark'` as
  `isDark` and key off that.
- Font sizes scale with `fontSizePreference`. Use `getFontClass(preference,
  { small, medium, large, xlarge })` from `src/utils/font-scale.ts` rather
  than hardcoding text sizes on user-facing copy.
- Long screens (camera, history, chat) keep their JSX local. Only extract
  components when reused across at least two screens.

## Navigation

- All routes live in `app/`. Adding a screen = adding a file. No manual
  router config.
- Modals are top-level files in `app/` (e.g. `profile.tsx`,
  `settings.tsx`) and opened with `router.push('/profile')`.
- The tab bar is configured in `app/(tabs)/_layout.tsx`. Adding a tab means
  adding a route file there *and* an entry in the tab bar config.

## Backend Contract

- All GraphQL operations live in `src/core/graphql/operations.ts` (search
  for `GQL_*`). When adding a new operation, add the string there and the
  wrapper in the relevant slice or service. Don't inline operation
  strings at the call site.
- All GraphQL requests go through one of the three transports in
  `src/core/graphql/client.ts`. Don't `fetch` the GraphQL endpoint
  directly — you'd skip the 401 fan-out and the consistent error
  formatting.
- The API gateway is NestJS + Mercurius (GraphQL). Schema lives in
  `server/app/api-gateway/`.
- The AI image-analysis pipeline (`uploadBPImage`, `analysisJob`,
  `submitBPReading`) is fronted by the gateway but executed in
  `server/app/ai-service/`.

## Dependency Management

- **Expo Go-bundled packages** (most `expo-*`, `@react-native-async-storage/async-storage`,
  `react-native-reanimated`, `react-native-gesture-handler`, etc.) use
  `pnpm expo install <pkg>` — **not** `pnpm add`. Expo Go ships a specific
  native version per SDK; mismatching JS-side versions throw at runtime
  with "Native module is null" (TypeScript and the bundler do not warn).
  Audit with `pnpm expo install --check`.
- **Pure JS packages** (zod, date-fns, etc.) use `pnpm add` as normal.
- **Native modules not bundled in Expo Go** (e.g. `react-native-mmkv`)
  use `pnpm add`. They will never work in Expo Go — they require a custom
  dev client. The codebase must handle that gracefully (see
  `core/storage/mmkv.storage.ts` for the try/catch + AsyncStorage
  fallback pattern).

## Working Rules For Claude

- Keep route-level UI and navigation logic inside `app/`.
- Reuse existing components from `components/` before creating new ones.
- Preserve cross-platform behavior: iOS, Android, and Expo web all run this
  code. Anything platform-specific belongs behind `Platform.OS` checks or
  in `.ios.tsx` / `.android.tsx` / `.web.tsx` siblings.
- Keep state changes aligned with the patterns in `src/store/use-app-store.ts`
  (optimistic update → remote → reconcile).
- Prefer small, focused changes. Do not refactor unrelated screens while
  fixing or adding a feature.
- When adding a `catch` block, log via `logWarn` rather than swallowing
  silently.
- Don't add new top-level dependencies without a clear reason — the bundle
  ships to phones. If a package's native binding ships with Expo Go,
  install with `pnpm expo install`; otherwise document why a custom dev
  client / EAS build is required.
- Don't store sensitive data in `kvStorage` (MMKV / AsyncStorage). Use
  `secureStorage` from `src/core/storage/secure.storage.ts` for anything
  credentials-adjacent.
- If a fix touches the GraphQL contract (operations in
  `src/core/graphql/operations.ts` or schema in `server/app/api-gateway/`),
  call out the cross-cutting impact in the PR.
