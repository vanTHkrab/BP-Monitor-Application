# Client (Mobile) — Claude Context

This file provides guidance for AI-assisted changes in the mobile app.
It supplements the root `CLAUDE.md` and the human-facing `README.md`.

## Project Summary

Expo SDK 54 + React Native 0.81 patient app. Expo Router file-based routing.
Single Zustand store. Offline-first reading capture with SQLite queue. Token
auth against the NestJS gateway via GraphQL.

## Run Commands

From `client/`:

```bash
pnpm install
pnpm start                  # Expo dev server
pnpm android | pnpm ios     # native runs
pnpm web                    # web preview (limited — uses AsyncStorage instead of SecureStore)
pnpm lint
pnpm exec tsc --noEmit -p . # type-check (no test runner is configured)
```

## Important Paths

| Path | Responsibility |
| --- | --- |
| `app/` | Route screens (Expo Router file-based). All navigation lives here. |
| `app/(tabs)/` | The bottom-tab navigator. Tab bar in `_layout.tsx`. |
| `components/` | Cross-screen UI primitives. Reuse before adding. |
| `constants/api.ts` | GraphQL endpoint resolver, token storage, all GraphQL operation strings. |
| `constants/colors.ts` | BP-status thresholds + Tailwind color tokens. |
| `data/local-db.ts` | SQLite schema + helpers for the offline queues. |
| `hooks/use-camera-analysis.ts` | State machine for BP image capture → AI analysis → save. `save()` delegates to `readings.slice.createReading` so the camera flow inherits the offline queue and optimistic UI used by manual entry. |
| `lib/graphql-client.ts` | Multipart-aware GraphQL client used by the AI image-upload path. |
| `lib/graphql-error.ts` | `GraphQLClientError` class — typed error thrown by `graphqlRequest` carrying `code` (server's `extensions.code`), `httpStatus`, and `retryAfterSec`. |
| `lib/error-message.ts` | General `formatError(error)` — hides raw English in production, surfaces it as `devDetail` in `__DEV__`. Use this for non-auth flows. |
| `services/camera.service.ts` | `analyzeImage`: presigned upload + enqueue AI + poll. Returns `uploadedUrl` so the caller can hand it to `createReading` without re-uploading. Reading persistence itself lives in the store, not here. |
| `store/use-app-store.ts` | Composer for the single Zustand store. Imports and merges every slice — keep slim. |
| `store/slices/` | Domain slices: `auth` (+ profile + sessions), `readings` (+ alerts), `community` (posts + comments), `caregivers`, `preferences` (theme + font + security), `network`. |
| `store/shared/` | Cross-slice helpers: `log` (`logWarn`, `communityDebug`), `client-id` (local-id helpers + `createClientId`), `error-format` (`formatAuthError` for login/register UX + legacy `authErrorToThai`), `mappers` (`xxxFromGql` + sorters). |
| `types/` | Shared TypeScript types. Add domain types here, not inline. |
| `utils/` | `export-data` (CSV/PDF), `reminders`, `font-scale`, `upload-image`, `phone-format` (Thai phone formatter + `stripPhoneDigits`). |

## Architectural Conventions

- **One store, multiple slices**: there is exactly one Zustand store
  (`useAppStore`). It is composed from slice files under `store/slices/`
  using Zustand's slice pattern — each slice is a `StateCreator<AppState,
  [], [], MySlice>` so cross-slice `get()` is fully typed and `set()` can
  update fields from any slice atomically. Don't introduce a second
  Zustand store or a context-based state holder. Add new state/actions to
  the slice they belong to; if a new domain doesn't fit any slice, create a
  new `xxx.slice.ts` and wire it into [use-app-store.ts](./store/use-app-store.ts).
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
- **Auth token**: always go through `setAuthToken` / `getAuthToken` /
  `clearAuthToken` from `constants/api.ts`. They handle the SecureStore vs.
  AsyncStorage (web) split. Never read or write the token directly.
- **Client IDs for offline records** must come from `createClientId(prefix,
  userId)`. It combines timestamp + 120 bits of randomness. Don't generate
  IDs ad-hoc with `Math.random().slice(...)`.
- **Image uploads**: BP images use the multipart path in
  `services/camera.service.ts`; avatars and other one-shot uploads use
  `utils/upload-image.ts → uploadImageToS3`.
- **Local-only IDs are strings prefixed with `local-` (readings) or
  `local-post-` (posts)**. Use the `isLocalReadingId`/`isLocalPostId` helpers
  in the store; don't string-match these prefixes elsewhere.
- **`lib/` vs `services/` vs `utils/` vs `hooks/`** — pick the bucket by what
  the file *is*, not what it touches. `services/` is for stateful I/O modules
  that own a workflow against a remote system (e.g. `camera.service.ts` owns
  upload + poll for AI analysis). `lib/` is for low-level integrations and
  third-party SDK wrappers that other code calls into (e.g. `graphql-client.ts`
  is a transport, not a workflow). `utils/` is for pure functions and small
  side-effect helpers that don't model a remote workflow (CSV/PDF export,
  font scaling, one-shot S3 uploads, local notification scheduling). `hooks/`
  is React hooks only — anything returning a hook must live here, anything
  not must not. When in doubt: workflow → `services/`, transport → `lib/`,
  helper → `utils/`, React state → `hooks/`.

## Styling Conventions

- NativeWind (Tailwind classes via `className`). Don't use raw `StyleSheet`
  unless interop demands it.
- Dark mode is driven by `themePreference` from the store, not by the
  device's `useColorScheme()`. Read `s.themePreference === 'dark'` as
  `isDark` and key off that.
- Font sizes scale with `fontSizePreference`. Use `getFontClass(preference,
  { small, medium, large, xlarge })` from `utils/font-scale.ts` rather than
  hardcoding text sizes on user-facing copy.
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

- All GraphQL operations live in `constants/api.ts` (search for `GQL_*`).
  When adding a new operation, add the string there and the wrapper in the
  store.
- The API gateway is NestJS + Mercurius (GraphQL). Schema lives in
  `server/app/api-gateway/`.
- The AI image-analysis pipeline (`uploadBPImage`, `analysisJob`,
  `submitBPReading`) is fronted by the gateway but executed in
  `server/app/ai-service/`.

## Working Rules For Claude

- Keep route-level UI and navigation logic inside `app/`.
- Reuse existing components from `components/` before creating new ones.
- Preserve cross-platform behavior: iOS, Android, and Expo web all run this
  code. Anything platform-specific belongs behind `Platform.OS` checks or in
  `.ios.tsx` / `.android.tsx` / `.web.tsx` siblings.
- Keep state changes aligned with the patterns in `store/use-app-store.ts`
  (optimistic update → remote → reconcile).
- Prefer small, focused changes. Do not refactor unrelated screens while
  fixing or adding a feature.
- When adding a `catch` block, log via `logWarn` rather than swallowing
  silently.
- Don't add new top-level dependencies without a clear reason — the bundle
  ships to phones.
- Don't store sensitive data in `AsyncStorage`. Use `expo-secure-store` for
  anything credentials-adjacent.
- If a fix touches the GraphQL contract (operations in `constants/api.ts`
  or schema in `server/app/api-gateway/`), call out the cross-cutting
  impact in the PR.
