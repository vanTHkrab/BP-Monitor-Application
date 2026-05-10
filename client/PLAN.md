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
