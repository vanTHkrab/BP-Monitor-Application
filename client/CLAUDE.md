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
pnpm start                  # Expo dev server (verifies bundled YOLO via prestart hook)
pnpm android | pnpm ios     # native runs (verifies bundled YOLO via pre* hook)
pnpm web                    # web preview (limited — uses AsyncStorage instead of SecureStore)
pnpm lint
pnpm test                   # jest-expo suite
pnpm exec tsc --noEmit -p . # type-check
pnpm sync-yolo-model        # copy yolo12n.onnx from server/app/ai-service/models/
pnpm verify-yolo-model      # confirm bundled model SHA256 matches the canonical copy
```

The `prestart` / `preandroid` / `preios` scripts run `verify-yolo-model` so a
stale on-device detector can never silently disagree with backend inference —
if the SHA256 drifts, the dev start fails until you run `pnpm sync-yolo-model`.

## Important Paths

| Path | Responsibility |
| --- | --- |
| `app/` | Route screens (Expo Router file-based). All navigation lives here. |
| `app/(tabs)/` | The bottom-tab navigator. Tab bar in `_layout.tsx`. |
| `components/` | Cross-screen UI primitives. Reuse before adding. |
| `constants/api.ts` | GraphQL endpoint resolver, token storage, all GraphQL operation strings. |
| `constants/colors.ts` | BP-status thresholds + Tailwind color tokens. |
| `data/local-db.ts` | SQLite schema + helpers. `pending_readings` is both the offline queue **and** the mirror of synced readings (rows carry a `syncStatus` of `pending` / `pending-image` / `synced` and a `remoteId` once confirmed); `cached_images` tracks 7-day-cached image files keyed by extracted S3 path. |
| `assets/models/yolo12n.onnx` | Bundled YOLOv12n detector (11.5 MB) — verbatim copy of `server/app/ai-service/models/yolo12n.onnx`. `scripts/verify-yolo-model.mjs` (wired as `prestart` / `preandroid` / `preios`) fails the dev start if the SHA256 drifts; run `pnpm sync-yolo-model` to refresh. Loaded by `lib/yolo/session.ts` for on-device pre-flight. |
| `lib/yolo/` | On-device YOLO inference. `types.ts` mirrors backend class layout (`0 BP_Monitor` / `1 BP_Screen_Monitor` / `2 dia` / `3 pulse` / `4 sys`); `preprocess.ts` does letterbox + JPEG-decode → `[1,3,512,512]` float32 RGB; `postprocess.ts` decodes Ultralytics-style `[1, 4+C, anchors]` + per-class NMS; `session.ts` lazy-loads the InferenceSession; `detect.ts` orchestrates the four. The backend equivalent is `server/app/ai-service/src/ai_service/analyzer/yolo.py` — keep them in sync, the model file is shared verbatim. |
| `services/preflight-detection.service.ts` | `preflightCheckImage` — runs the on-device detector, classifies the result as `ok` / `no-monitor` / `missing-fields`, and (on `ok`) auto-crops the source image around the monitor bbox + padding. UI uses the cropped variant for both the preview and the upload so backend YOLO sees the same crop the on-device pass agreed on. Pre-flight is **warn, not block** — the camera screen always offers a "ส่งต่อไป" override so an on-device false negative never strands the user. |
| `hooks/use-camera-analysis.ts` | State machine for BP image capture → AI analysis → save. `runPreflight()` runs the on-device YOLO check and stashes the result on `state.preflight` so the UI can show the cropped preview (on `ok`) or the warning banner (on `no-monitor` / `missing-fields`). `analyze()` is unchanged — the camera screen calls it after the user confirms. `save()` delegates to `readings.slice.createReading` so the camera flow inherits the offline queue and optimistic UI used by manual entry. |
| `lib/graphql-client.ts` | Multipart-aware GraphQL client used by the AI image-upload path. |
| `lib/graphql-error.ts` | `GraphQLClientError` class — typed error thrown by `graphqlRequest` carrying `code` (server's `extensions.code`), `httpStatus`, and `retryAfterSec`. |
| `lib/error-message.ts` | General `formatError(error)` — hides raw English in production, surfaces it as `devDetail` in `__DEV__`. Use this for non-auth flows. |
| `services/camera.service.ts` | `analyzeImage`: presigned upload + enqueue AI + poll. Returns `uploadedUrl` so the caller can hand it to `createReading` without re-uploading. Reading persistence itself lives in the store, not here. |
| `store/use-app-store.ts` | Composer for the single Zustand store. Imports and merges every slice — keep slim. |
| `store/slices/` | Domain slices: `auth` (+ sessions), `profile` (me + avatar queue), `readings` (+ alerts), `community` (posts + comments), `caregivers`, `preferences` (theme + font + security), `network`. |
| `store/shared/` | Cross-slice helpers: `log` (`logWarn`, `communityDebug`), `client-id` (local-id helpers + `createClientId`), `error-format` (`formatAuthError` for login/register UX + legacy `authErrorToThai`), `mappers` (`xxxFromGql` + sorters). |
| `types/` | Shared TypeScript types. Add domain types here, not inline. |
| `utils/` | `export-data` (CSV/PDF), `reminders`, `font-scale`, `upload-image`, `phone-format` (Thai phone formatter + `stripPhoneDigits`), `image-prepare` (resize + recompress images before they hit the AI / S3 path), `image-cache` (`resolveImageUri` / `cleanupExpiredImages` — downloads signed S3 images into `Paths.cache` keyed by extracted S3 path, 7-day TTL). |
| `utils/storage-image.ts` | Thin pass-through for signed S3 image URLs — the gateway now returns short-lived signed GET URLs for all stored images (avatars, BP photos). Kept as a stub so existing callsites compile without churn; contains no active transformation logic. |
| `utils/app-notifications.ts` | In-app notification queue — `InAppNotificationItem` type + `AsyncStorage`-backed store for non-push alerts surfaced inside the app (e.g. readings alerts). Separate from `utils/reminders.ts` (scheduled local notifications). |
| `hooks/use-resolved-image-uri.ts` | React hook over `image-cache` — feeds remote URI on mount, swaps to the `file://` once `resolveImageUri` returns. Used by `reading-detail-modal` so signed-URL rotation is transparent and history images render offline. |
| `components/ui/avatar.tsx`, `components/ui/image.tsx` | UI primitives. `UIImage` wraps `expo-image` with NativeWind className, internal error state, and a fallback slot. `Avatar` composes it with initials / Ionicons fallback and xs–xl sizes. Use these instead of `<Image>` from `react-native`. |

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
- **Session-expired auto-logout**: the GraphQL transports
  (`graphqlRequest` in `constants/api.ts`, `gqlRequest` / `gqlUpload` in
  `lib/graphql-client.ts`) call `fireUnauthenticated()` when the server
  returns HTTP 401 or `extensions.code === 'UNAUTHENTICATED'` on a
  **token-bearing** request. The auth slice registers the handler via
  `setUnauthenticatedHandler` at store-composition time; it dispatches to
  `handleSessionExpired()` which idempotently clears local state and
  shows a Thai banner on the login screen. Don't re-implement 401
  handling in individual slices — let the transport fire and the slice
  action will run once. New GraphQL transports MUST call
  `fireUnauthenticated()` on the same conditions, or session revocation
  from another device won't propagate.
- **Client IDs for offline records** must come from `createClientId(prefix,
  userId)`. It combines timestamp + 120 bits of randomness. Don't generate
  IDs ad-hoc with `Math.random().slice(...)`.
- **Image uploads**: BP images use the multipart path in
  `services/camera.service.ts`; avatars and other one-shot uploads use
  `utils/upload-image.ts → uploadImageViaPresign`. Both paths share the
  same wire flow (presign → PUT → confirm) but **must not** use
  `new Blob([Uint8Array])` for the PUT body — RN's Blob refuses
  ArrayBuffer/Uint8Array at runtime even though the TS types accept it.
  On native, stream the file with `FileSystem.uploadAsync` from
  `expo-file-system/legacy` (`uploadType: BINARY_CONTENT`); the
  fetch+Blob path is web-only.
- **On-device pre-flight**: BP image captures run through
  `services/preflight-detection.service.ts → preflightCheckImage` before
  the backend upload. The bundled YOLO (`assets/models/yolo12n.onnx`) is
  the **same model file** as `server/app/ai-service/models/yolo12n.onnx`
  — SHA256 is enforced by `scripts/verify-yolo-model.mjs` at every
  `pnpm start` / `pnpm android` / `pnpm ios`. If the backend retrains the
  detector, run `pnpm sync-yolo-model` and commit both copies in the
  same change. Class IDs and thresholds (conf 0.25 / IoU 0.45) in
  `lib/yolo/types.ts` mirror `analyzer/yolo.py::CLASS_NAMES` /
  `_conf_threshold` — change one side, change the other. Pre-flight is
  **warn, not block** — on a `no-monitor` / `missing-fields` verdict the
  UI shows a Thai warning banner with both "ถ่ายใหม่" and "ส่งต่อไป"
  buttons; "ส่งต่อไป" hands the original (uncropped) image to
  `analyze()` so on-device false negatives never strand the user.
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
- Font sizes scale with `fontSizePreference`. Prefer the named presets in
  `utils/font-scale.ts` —
  `fontPresetClass.<token>(fontSizePreference)` where `<token>` is one of
  `title` / `subtitle` / `heading` / `cardTitle` / `body` / `bodySmall` /
  `caption` / `label`. These tokens encode the audited drift winners across
  screens, so reuse them before reaching for `getFontClass`. Fall back to
  raw `getFontClass(preference, { small, medium, large, xlarge })` only
  when the scale is genuinely domain-specific (BP value display, auth
  hero, button size variants, banner-intentional drift) and add a short
  `// raw: <why>` comment on the site so the next reader knows it's a
  conscious exception rather than pre-preset code.
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
