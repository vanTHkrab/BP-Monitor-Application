# BP Monitor Mobile — Feature Plan

A working backlog for the `client/` workspace. Reflects what is shipped today,
what is in flight, and what is queued. Update this when you start, finish, or
re-prioritize work.

> Items in **In Flight** and **Backlog** are proposals — confirm scope with
> the team before starting.

---

## Shipped

### Auth
- Phone + password registration and login (GraphQL)
- Bearer-token auth, persisted in `expo-secure-store` on iOS/Android with
  AsyncStorage fallback on web
- One-time migration of legacy AsyncStorage tokens into SecureStore
- Logout (single device) and logout-all-devices
- Password change
- Active-session list (`fetchSessions`)
- Account deletion (`deleteAllMyData` + local SQLite wipe)

### Blood Pressure Capture
- Manual reading entry (SYS / DIA / pulse)
- Camera capture (`expo-camera`) of the BP monitor screen
- Gallery import (`expo-image-picker`)
- AI-assisted OCR via the AI service (`uploadBPImage` → poll `analysisJob`)
- Auto-prefill of SYS/DIA/pulse from confident AI readings
- BP-status classification (normal / elevated / high / critical / low) and
  status-specific alert copy

### History & Export
- Reading list with filters
- CSV export
- PDF export (via `expo-print` + `expo-sharing`)

### Offline-First Sync
- SQLite-backed pending-reading queue (`data/local-db.ts`)
- **Hybrid SQLite mirror** — `pending_readings` doubles as the cache of
  confirmed server rows (`syncStatus` + `remoteId` columns). `fetchReadings`
  upserts every remote row; `syncPendingReadings` / `createReading` mark
  rows synced in place rather than deleting. History survives reinstall
  and renders offline before the network round-trip
  (`hydratePendingReadings` is awaited at boot).
- **7-day image cache** (`utils/image-cache.ts` + `hooks/use-resolved-image-uri.ts`)
  — signed S3 GET URLs (10-min TTL) are downloaded to `Paths.cache`
  keyed by the extracted S3 path so URL rotation is transparent.
  Cleanup runs once per app launch.
- `syncStatus` surfaced on `BloodPressureReading` (`pending` / `pending-image`
  / `synced`); the reading-detail modal reads it for the "รอซิงก์" /
  "รอซิงก์รูป" / "ซิงก์แล้ว" label instead of string-matching the id.
- Local-first community posts with deferred sync
- Promise-based sync mutex to prevent concurrent double-syncs
- Image upload to S3 with retain-as-pending fallback on failure

### Community
- Feed (posts) with categories
- Per-post comments and replies
- Like / unlike for posts and comments
- Optimistic UI with server-state reconciliation

### Alerts & Caregivers
- Server-issued alerts list (read / unread)
- Mark-read and mark-all-read with optimistic update
- Caregiver ↔ patient linking and unlinking

### Personalization & Accessibility
- Light / dark theme preference (persisted)
- Font-size preference (small / medium / large / xlarge)
- Sensitive-data lock with password unlock
- Biometric-unlock opt-in (`expo-local-authentication`)

### Reminders
- Local notifications via `expo-notifications` (`utils/reminders.ts`)
- Sound options

### Reliability
- 30-second GraphQL request timeout
- Network status tracking via `@react-native-community/netinfo`
- `__DEV__`-guarded `logWarn` for previously silent catch blocks

---

## In Flight

| Item | Notes |
|---|---|
| Camera screen polish | Finish the migration to the `useCameraAnalysis` hook pattern in `app/(tabs)/camera.tsx`. Some helper variables (`isCapturing`, `tabBarTotalHeight`) are stubs and need real wiring. |

---

## Backlog (Should Have)

### Security
- [ ] **Stricter BP input validation** — reject SYS outside 50–250, DIA outside 30–150, pulse outside 30–220 before save. Currently any positive number is accepted.
- [ ] **Anonymized export** — optional flag on CSV/PDF export to strip `userId`, internal IDs, and S3 image URLs.
- [ ] **Certificate pinning** — pin the gateway TLS cert to mitigate MITM on untrusted networks. Health data warrants this.
- [ ] **Validate `imageUri` schema/domain** — bound the URIs allowed into the store to local file://, content://, or the configured S3 host.

### Reliability
- [ ] **Replace `Math.random` client IDs with `expo-crypto.randomUUID()`** — the current implementation is collision-resistant but not cryptographic. Adding `expo-crypto` is a small dep cost.
- [ ] **Request deduplication on the GraphQL client** — same-query-in-flight should return the same promise.
- [ ] **Exponential backoff on sync** — failed sync attempts currently retry on the next call only. A bounded backoff would smooth network blips.
- [ ] **Loading slice in the store** — surface `isLoadingReadings` / `isLoadingPosts` so screens can show real spinners instead of inferred states.
- [ ] **Error slice in the store** — collect `logWarn` events into a queryable list so screens can show recoverable-error toasts.

### Type Safety
- [ ] **Type the GraphQL responses** — replace `(u: any)` / `(r: any)` / `error: any` with explicit response interfaces. This catches schema drift at compile time.

### Testing
- [ ] **Smoke-test scaffold** — at minimum, jest-expo + a test for the auth flow and one for offline reading creation.
- [ ] **Detox or Maestro** for end-to-end on iOS + Android.

### UX
- [ ] **Pull-to-refresh** on history and chat tabs.
- [ ] **Empty states** for first-run users on home, history, chat, alerts.
- [ ] **Date-range picker** in history (currently filter is coarse).

### Profile screen hardening (from senior review)

Findings from a senior pass over [app/profile.tsx](./app/profile.tsx).
Most are independent and ship as separate small PRs; **#1 and #2 are
load-bearing** (auth bypass + data loss visible to the patient) and
should land first, ideally together.

- [ ] **#1 — Biometric unlock must verify server password before
  flipping `sensitiveDataUnlocked`.** Currently bypassed via direct
  `useAppStore.setState(...)` from the screen at
  [profile.tsx:289](./app/profile.tsx#L289), while the password path
  round-trips `GQL_VERIFY_PASSWORD`. Two sub-fixes:
  (a) gate biometric-pref enablement on a prior verified password,
  and (b) move the flip into a `preferences` slice action so it doesn't
  reach across slice boundaries.
- [ ] **#2 — Gate `useEffect([user])` on `!isEditing`** so a
  `useFocusEffect`-triggered `fetchMyProfile()` doesn't overwrite
  in-progress edits.
  [profile.tsx:129-140](./app/profile.tsx#L129-L140)
- [ ] **#3 — Convert form validation Alerts to inline
  `CustomInput.error`.** Violates the documented "errors are inline,
  not Alert" convention in [CLAUDE.md](./CLAUDE.md).
  [profile.tsx:298-330](./app/profile.tsx#L298-L330)
- [ ] **#4 — Per-field selectors instead of full `useAppStore()`
  destructure.** Current code re-renders the whole form on every
  unrelated store mutation (community posts arriving, network flips,
  etc.). Same file already uses selectors on lines 84-85 — pattern is
  inconsistent.
  [profile.tsx:73-83](./app/profile.tsx#L73-L83)
- [ ] **#5 — Move `lastProfileLeaveAt` off module-global state.**
  `let` at module scope is invisible to dev tools and the cleanup fires
  on `hideSensitiveData` toggle while focused, producing false "leave"
  timestamps. Better model: "last unlock at" in the `preferences` slice,
  plus `AppState` background detection.
  [profile.tsx:42](./app/profile.tsx#L42)
- [ ] **#6 — "Cancel" must revert form fields to the current `user.*`
  values.** Today it only flips the read-only flag; edited values
  remain in local state.
  [profile.tsx:383](./app/profile.tsx#L383)
- [ ] **#7 — Drop the screen-side avatar guard.** The
  `avatar !== user.avatar` comparison races the `useEffect` reset and
  duplicates the slice's own `^https?://` short-circuit. Let the slice
  decide.
  [profile.tsx:355-357](./app/profile.tsx#L355-L357)
- [ ] **#8 — Move stats reduction off the render path.** `useMemo`
  over the full `readings` array recomputes whenever readings change.
  Expose a memoized selector on the readings slice or query an
  aggregate from the gateway.
  [profile.tsx:174-199](./app/profile.tsx#L174-L199)
- [ ] **#9 — Wrap the form in `KeyboardAvoidingView`.** iOS keyboard
  covers the Save button and the height/weight inputs.
- [ ] **#10 — `accessibilityLabel` on icon-only `TouchableOpacity`.**
  Back arrow, edit toggle, avatar camera button render as bare
  "button" to TalkBack/VoiceOver — relevant for a patient-facing
  medical app, especially elderly users.

> Out of scope for this list (per the "no refactor noise" rule at the
> bottom of this file): the hex-literal theming drift in the gender
> pill and the duplicated check inside `uploadMyAvatar`. Park those
> as inline notes in the PR that touches the file.

---

## Backlog (Could Have)

- [ ] **Trend insights on home** — week-over-week diff, "best/worst day", target-range %.
- [ ] **Reminder presets** — "morning + evening", "after meals", etc.
- [ ] **Caregiver push notifications** — when a linked patient logs a critical reading.
- [ ] **Multi-language UI** — currently Thai-only in copy. Move strings to `i18n` (e.g. `i18n-js`).
- [ ] **Voice input** for SYS/DIA/pulse for accessibility.
- [ ] **Bluetooth BP monitor integration** (long-term; needs native module).

---

## Won't Have (For Now)

- Apple Health / Google Fit sync — out of scope until clinical workflow is settled.
- A second state-management library — keep the single Zustand store.

---

## How to Use This File

- When you start a backlog item, move it to **In Flight**.
- When you ship one, move it to **Shipped** and add the relevant function or
  module name in parens so future readers can find it.
- Keep entries scoped to user-visible features or reliability/security work.
  Refactors and infra cleanups belong in the PR description, not here.
