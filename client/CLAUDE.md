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
pnpm sync-yolo-model        # copy yolo11n.onnx + crnn_int8.onnx from server/app/ai-service/models/
pnpm verify-models          # confirm bundled model SHA256s match the ai-service manifest
```

The `prestart` / `preandroid` / `preios` scripts run `verify-models` so a stale
on-device model (YOLO detector or CRNN OCR) can never silently disagree with
backend inference — if either SHA256 drifts from the ai-service manifest
(`EXPECTED_HASHES.json`), the dev start fails until you run `pnpm sync-yolo-model`.

## Important Paths

| Path | Responsibility |
| --- | --- |
| `app/` | Route screens (Expo Router file-based). All navigation lives here. |
| `app/(tabs)/` | The bottom-tab navigator. Tab bar in `_layout.tsx`. |
| `components/` | Cross-screen UI primitives. Reuse before adding. |
| `constants/api.ts` | GraphQL endpoint resolver, token storage, all GraphQL operation strings. |
| `constants/colors.ts` | BP-status thresholds + Tailwind color tokens. |
| `data/local-db.ts` | SQLite schema + helpers. `pending_readings` is both the offline queue **and** the mirror of synced readings (rows carry a `syncStatus` of `pending` / `pending-image` / `synced` and a `remoteId` once confirmed); `cached_images` tracks 7-day-cached image files keyed by extracted S3 path. |
| `assets/models/` | Bundled on-device ONNX models — verbatim copies of the ai-service's: `yolo11n.onnx` (YOLOv11n detector, 10.7 MB) and `crnn_int8.onnx` (7-seg CRNN digit recognizer, 1.2 MB). `scripts/verify-models.mjs` (wired as `prestart` / `preandroid` / `preios`) fails the dev start if either SHA256 drifts from the ai-service manifest `EXPECTED_HASHES.json`; run `pnpm sync-yolo-model` to refresh both. The config plugin `modules/bp-vision/plugin/withBpVisionModels.js` copies both into `android/app/src/main/assets/models/` at every `expo prebuild` so the native `bp-vision` module loads them from the APK. YOLO is loaded by `lib/yolo/session.ts` (JS pre-flight, currently unwired) and by the native module; CRNN by the native module for on-device OCR. |
| `lib/yolo/` | On-device YOLO inference. `types.ts` mirrors backend class layout (`0 BP_Monitor` / `1 BP_Screen_Monitor` / `2 dia` / `3 pulse` / `4 sys`); `preprocess.ts` does letterbox + JPEG-decode → `[1,3,512,512]` float32 RGB; `postprocess.ts` decodes Ultralytics-style `[1, 4+C, anchors]` + per-class NMS; `session.ts` lazy-loads the InferenceSession; `detect.ts` orchestrates the four. The backend equivalent is `server/app/ai-service/src/ai_service/analyzer/yolo.py` — keep them in sync, the model file is shared verbatim. |
| `services/preflight-detection.service.ts` | `preflightCheckImage` — runs the on-device detector, classifies the result as `ok` / `no-monitor` / `missing-fields`, and (on `ok`) auto-crops the source image around the monitor bbox + padding. **Currently unwired from `app/(tabs)/camera.tsx`** — the camera screen no longer calls it, so captures are not gated or auto-cropped on-device before upload. Kept in place (with `lib/yolo/`, the bundled model, and `components/live-preflight-overlay.tsx` + `hooks/use-live-preflight.ts`) so re-wiring it is a small revert rather than a rebuild. |
| `hooks/use-camera-analysis.ts` | State machine for BP image capture → AI analysis → save. `runPreflight()` still exists and can run the on-device YOLO check via `state.preflight`, but `app/(tabs)/camera.tsx` no longer calls it (see `services/preflight-detection.service.ts` above). The camera screen calls `analyze()` directly after capture **when online**; when offline it calls `readOnDevice()` instead (on-device OCR via `lib/ocr/` — backed by the `bp-vision` native module on Android; unavailable on iOS / web / Expo Go) and falls through to manual entry with an informative offline banner, skipping the doomed backend request. `save()` delegates to `readings.slice.createReading` so the camera flow inherits the offline queue and optimistic UI used by manual entry; it accepts an optional `measuredAt` — the camera screen passes the capture timestamp so an offline capture-then-late-save keeps the real measurement time. |
| `lib/ocr/` | On-device BP-display OCR. `types.ts` defines the engine contract (`OnDeviceOcrResult` = `{ sys, dia, pulse, confidence }` \| `{ unavailable: true, reason }`); `read.ts → readBpFromImage` is a thin pass-through over the `bp-vision` native module's `readBp` (`modules/bp-vision → readBpOnDevice`), which runs the full on-device pipeline (YOLO pass 1 → Stage-2 field-layout rotation → YOLO pass 2 → per-field CRNN → validate → aggregate) natively on Android. Returns `unavailable` on iOS / web / Expo Go and on any ordinary failure (no monitor, unreadable fields, out-of-range, sys≤dia) — never throws. A successful read feeds the same prefill + low-confidence confirm flow as backend results via `use-camera-analysis.ts → readOnDevice()`. The on-device engine deliberately skips perspective rectification (Stage 1) and the backend's 0.60 success floor; see `modules/bp-vision/android/.../BpOcrPipeline.kt`. |
| `utils/pending-image-store.ts` | Durable storage for photos attached to queued readings. Capture/manipulator output lives in OS *cache* storage which can be evicted before an offline queue drains; `persistPendingImage` copies the file into `Paths.document/pending-images/` keyed by the reading's clientId (called by `createReading` when queueing with a still-local image; falls back to the cache URI on failure — never blocks the save). `deletePendingImageForClientId` releases the copy once the row is confirmed (`markReadingSynced` call sites, local deletes); `cleanupOrphanedPendingImages` is the app-launch GC sweep in `app/_layout.tsx` that removes files whose clientId no longer matches an unsynced `pending_readings` row. |
| `lib/graphql-client.ts` | Multipart-aware GraphQL client used by the AI image-upload path. |
| `lib/graphql-error.ts` | `GraphQLClientError` class — typed error thrown by `graphqlRequest` carrying `code` (server's `extensions.code`), `httpStatus`, and `retryAfterSec`. |
| `lib/error-message.ts` | General `formatError(error)` — hides raw English in production, surfaces it as `devDetail` in `__DEV__`. Use this for non-auth flows. |
| `services/camera.service.ts` | `analyzeImage`: presigned upload + enqueue AI + poll. Returns `uploadedUrl` so the caller can hand it to `createReading` without re-uploading. Reading persistence itself lives in the store, not here. |
| `store/use-app-store.ts` | Composer for the single Zustand store. Imports and merges every slice — keep slim. |
| `store/slices/` | Domain slices: `auth` (+ sessions), `profile` (me + avatar queue), `readings` (+ alerts), `community` (posts + comments), `caregivers`, `preferences` (theme + font + security), `network`. |
| `store/shared/` | Cross-slice helpers: `log` (`logWarn`, `communityDebug`), `client-id` (local-id helpers + `createClientId`), `error-format` (`formatAuthError` for login/register UX + legacy `authErrorToThai`), `mappers` (`xxxFromGql` + sorters). |
| `types/` | Shared TypeScript types. Add domain types here, not inline. |
| `utils/` | `export-data` (CSV/PDF file I/O + share sheet), `export-report` (pure export builders — CSV bodies with UTF-8 BOM, report-style PDF HTML with the embedded logo, `BP-Report_{name}_{period}` filenames, `resolveExportSubjectName` for caregiver-viewing exports), `date-format` (shared Thai date helpers — `formatThaiDateTime` "10 ก.ค. 2569 21:52" style used by both UI and exports), `reminders`, `font-scale`, `upload-image`, `phone-format` (Thai phone formatter + `stripPhoneDigits`), `image-prepare` (resize + recompress images before they hit the AI / S3 path), `image-cache` (`resolveImageUri` / `cleanupExpiredImages` — downloads signed S3 images into `Paths.cache` keyed by extracted S3 path, 7-day TTL). |
| `utils/storage-image.ts` | Thin pass-through for signed S3 image URLs — the gateway now returns short-lived signed GET URLs for all stored images (avatars, BP photos). Kept as a stub so existing callsites compile without churn; contains no active transformation logic. |
| `utils/app-notifications.ts` | In-app notification queue — `InAppNotificationItem` type + `AsyncStorage`-backed store for non-push alerts surfaced inside the app (e.g. readings alerts). Separate from `utils/reminders.ts` (scheduled local notifications). |
| `hooks/use-resolved-image-uri.ts` | React hook over `image-cache` — feeds remote URI on mount, swaps to the `file://` once `resolveImageUri` returns. Used by `reading-detail-modal` so signed-URL rotation is transparent and history images render offline. |
| `hooks/use-focus-fetch.ts` | `useFocusFetch(fetch)` — screen-focus refetch helper: wraps expo-router's `useFocusEffect` with `InteractionManager.runAfterInteractions` (the fetch starts only after the tab/stack transition finishes, so switching never janks) plus an in-flight guard against stacked duplicate fetches. Data-bearing screens (home, history, chat, caregivers, history-list) call it with the relevant store `fetchX` actions so server data reconciles silently on every focus — no spinners over already-rendered content. Pass a `useCallback`-stable callback. |
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
- **On-device pre-flight (currently bypassed in the UI)**: BP image
  captures used to run through
  `services/preflight-detection.service.ts → preflightCheckImage` before
  the backend upload, gating on a `no-monitor` / `missing-fields` verdict
  with a warning banner. As of the full-screen camera redesign,
  `app/(tabs)/camera.tsx` calls `analyze()` directly after capture when
  online (offline captures skip it — see the offline-capture bullet below)
  and does not call `preflightCheckImage` / `runPreflight` — there is no
  on-device gate, crop, or warning banner in the current UI; the backend
  YOLO pass still does its own ROI detection server-side. The service,
  `lib/yolo/`, the bundled model, and the live-preview overlay
  (`components/live-preflight-overlay.tsx` + `hooks/use-live-preflight.ts`)
  are all left in place, unwired but ready, so this can be reverted with a
  small diff rather than a rebuild. The bundled YOLO
  (`assets/models/yolo11n.onnx`) is still the **same model file** as
  `server/app/ai-service/models/yolo11n.onnx` — SHA256 is still enforced
  by `scripts/verify-models.mjs` at every `pnpm start` / `pnpm android`
  / `pnpm ios` regardless of whether the UI calls the detector. If the
  backend retrains the detector, run `pnpm sync-yolo-model` and commit
  both copies in the same change. Class IDs and thresholds (conf 0.25 /
  IoU 0.45) in `lib/yolo/types.ts` mirror `analyzer/yolo.py::CLASS_NAMES` /
  `_conf_threshold` — change one side, change the other; this contract
  still matters even with pre-flight unwired, since a revert must not
  silently drift from the backend.
- **Offline capture flow**: `startCaptureFlow` in `app/(tabs)/camera.tsx`
  branches on the store's `isOnline` before calling `analyze()`. Offline it
  skips the backend request entirely, tries the on-device OCR hook
  (`use-camera-analysis.ts → readOnDevice()`, backed by the `bp-vision`
  native OCR module on Android — unavailable on iOS / web / Expo Go), keeps the captured
  photo, opens the manual entry sheet, and shows an informative (cyan, not
  error-red) offline banner. The save queues through the normal offline
  path; `measuredAt` is stamped at capture time (not save time), so a late
  save doesn't shift the measurement timestamp.
- **Durable photos for queued readings**: when `createReading` queues a
  reading whose image is still a local file, the file is copied out of OS
  cache storage into `Paths.document/pending-images/` via
  `utils/pending-image-store.ts` (keyed by clientId) before the queue row
  is written — otherwise the OS can evict the cache file before the user
  reconnects and the sync silently drops the photo. The copy is deleted
  after `markReadingSynced` (and on local delete); an app-launch GC sweep
  (`cleanupOrphanedPendingImages` in `app/_layout.tsx`) removes copies
  orphaned by a crash between steps. Copy failure falls back to the
  original cache URI and never blocks the save.
- **Local-only IDs are strings prefixed with `local-` (readings) or
  `local-post-` (posts)**. Use the `isLocalReadingId`/`isLocalPostId` helpers
  in the store; don't string-match these prefixes elsewhere.
- **Community posts sync; comments are online-only (by design).** Posts use
  the same offline queue + trigger set as readings — `syncPendingPosts` runs
  on bootstrap-online, the NetInfo offline→online edge, and app-background in
  `app/_layout.tsx`, plus community-screen focus (`app/(tabs)/chat.tsx` via
  `use-focus-fetch`). A queued post whose upload keeps failing no longer sits
  on a silent "บันทึกในเครื่อง" badge: the slice sets a runtime-only
  `CommunityPost.syncError` flag on the failed row (cleared at the start of
  the next pass), and `components/community-post-card.tsx` renders a tappable
  "ซิงก์ไม่สำเร็จ · ลองใหม่" badge that re-runs `syncPendingPosts`. Comments
  (`createComment`/`updateComment`/`deleteComment`) have **no** offline queue —
  they need a server-side post id, and a comment on an unsynced `local` post
  has none yet. Instead of a silent `return false`, the composer in `chat.tsx`
  computes a `commentBlockReason` (offline, or the post is still `local`),
  shows an inline notice, and disables send — so the limitation is honest. A
  real offline comment queue (SQLite pending-comment-actions + a
  `syncPendingComments` drain + local→remote post-id remapping) is a tracked
  follow-up, not wired today.
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
  conscious exception rather than pre-preset code. `getFontClass` /
  `getFontNumber` also accept an optional smaller `xsmall` rung: the
  smallest *selectable* preference (`small`) resolves to `xsmall` when the
  site declares one, else to `small`. This is the reason "เล็ก" renders the
  smallest size a site defines — don't add an `xsmall` value larger than the
  site's `small`. **All 8 `fontPresetClass` tokens now carry an `xsmall`
  rung** one readable step below their `small`, so "เล็ก" resolves to the
  smaller rung uniformly across every preset-based screen (matching the raw
  components that already declared `xsmall`) — no more per-page drift where
  some surfaces shrank and others didn't. Keep the ladder monotonic
  (`xsmall < small < medium < large < xlarge`) and honour the elderly-first
  readability floor: ~10px minimum for any text, ≥11px for body/primary
  content (the `body` preset's `xsmall` sits exactly at that 11px floor).
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
