# BP Monitor — Mobile App (Expo + React Native)

The patient-facing mobile app for the BP Monitor platform. Patients use it to log
blood-pressure readings (manually or via the device camera with AI-assisted OCR),
review their history, set reminders, talk to other patients in a community feed,
and link with caregivers.

This is the `client/` workspace of the [BP Monitor monorepo](../README.md).
For repo-wide guidance, see the root `CLAUDE.md`.

---

## Tech Stack

| Area | Library |
|---|---|
| Runtime | Expo SDK 54, React Native 0.81, React 19 |
| Routing | Expo Router 6 (file-based, `app/`) |
| Styling | NativeWind 4 (Tailwind for RN), `expo-linear-gradient` |
| State | Zustand 5 (single store in `store/useAppStore.ts`) |
| Persistence | `expo-sqlite` (offline queue), `expo-secure-store` (auth token), `@react-native-async-storage/async-storage` (preferences) |
| Network | GraphQL over `fetch` (custom client in `constants/api.ts` and `lib/graphql-client.ts`), `socket.io-client` for real-time chat |
| Camera / Media | `expo-camera`, `expo-image-picker`, `expo-image` |
| Notifications | `expo-notifications` (local reminders) |
| Charts | `react-native-gifted-charts` |
| Auth (device) | `expo-local-authentication` (biometrics), `expo-secure-store` |
| Misc | `expo-print` + `expo-sharing` (PDF/CSV export), `@react-native-community/netinfo` |

---

## Prerequisites

- Node.js 20+
- pnpm 11+ (matches the `packageManager` field in `package.json` — `corepack enable` is the easiest way)
- Expo CLI is bundled — no global install needed
- For native builds: Xcode (iOS) or Android Studio (Android)
- A reachable instance of the API gateway (`server/app/api-gateway`) on the
  same LAN as your phone, or accessible via tunnel

## Setup

```bash
# from repo root
pnpm --dir client install

# point the app at your API gateway (LAN IP, not localhost — the phone needs to reach it)
echo "EXPO_PUBLIC_API_URL=http://192.168.x.x:3000/graphql" > client/.env
```

> Without `EXPO_PUBLIC_API_URL`, the app falls back to an Expo-hostUri guess
> and then to a hardcoded LAN IP that only works inside the original
> development network. Always set this for your own machine.

## Run

```bash
# from repo root
pnpm --dir client start          # Expo dev server with QR code
pnpm --dir client android        # build + install on a connected Android device
pnpm --dir client ios            # build + run on iOS simulator
pnpm --dir client web            # web preview (uses AsyncStorage instead of SecureStore)
pnpm --dir client lint
```

## Project Structure

```
client/
├── app/                       # Expo Router routes (file-based)
│   ├── _layout.tsx            # Root layout: theme + network + notifications bootstrap
│   ├── index.tsx              # Auth gate → tabs or /auth
│   ├── auth.tsx               # Login + register
│   ├── (tabs)/                # Main bottom-tab navigator
│   │   ├── _layout.tsx        # Tab bar config
│   │   ├── index.tsx          # Home dashboard + readings chart
│   │   ├── camera.tsx         # BP image capture + AI OCR + manual entry
│   │   ├── history.tsx        # Reading history with filters + CSV/PDF export
│   │   ├── chat.tsx           # Community feed (posts + comments)
│   │   └── menu.tsx           # Settings shortcuts
│   ├── profile.tsx            # Profile editor (modal)
│   ├── settings.tsx           # App settings (modal)
│   ├── security.tsx           # Sensitive-data lock / biometrics (modal)
│   ├── caregivers.tsx         # Caregiver-patient links (modal)
│   └── help.tsx               # Help & FAQ (modal)
├── components/                # Shared UI primitives (buttons, inputs, gradients, animations)
├── constants/                 # api.ts (GraphQL client + queries), colors.ts (BP status), tabs.ts
├── data/                      # local-db.ts (SQLite schema + offline queues), mockData.ts
├── hooks/                     # use-camera-analysis, use-color-scheme, use-theme-color
├── lib/                       # graphql-client.ts (multipart-aware GraphQL client)
├── services/                  # camera.service.ts (BP image upload + analysis polling)
├── store/                     # useAppStore.ts (single Zustand store)
├── types/                     # Shared TypeScript types
├── utils/                     # export-data.ts, reminders.ts, font-scale.ts, upload-image.ts
├── assets/                    # Fonts, images, sounds
├── android/, ios/             # Native projects (rebuilt by `expo prebuild`)
├── app.json                   # Expo config
├── tailwind.config.js         # NativeWind config
└── tsconfig.json
```

## Key Behaviors

- **Offline-first**: every BP reading and community post is written to SQLite
  first, then synced to the API. The Zustand store keeps optimistic UI state
  and reconciles on `fetchReadings` / `fetchPosts`.
- **Sync mutex**: `syncPendingReadings` and `syncPendingPosts` use a
  promise-based mutex — concurrent callers share the in-flight promise rather
  than racing past a boolean flag.
- **Auth token**: stored in `expo-secure-store` on iOS/Android, falls back to
  AsyncStorage on web. A one-time migration moves any legacy token from
  AsyncStorage into SecureStore on first read.
- **Theme + accessibility**: `themePreference` (light/dark) and
  `fontSizePreference` (small/medium/large/xlarge) are hydrated from
  AsyncStorage at boot and applied via NativeWind classes + `getFontClass`.
- **Sensitive-data gate**: when `hideSensitiveData` is enabled, BP values and
  PII are masked until the user re-enters their password
  (`unlockSensitiveData`). Biometric unlock is opt-in via
  `expo-local-authentication`.
- **Dev-only logging**: errors caught in store actions are reported via a
  `__DEV__`-guarded `logWarn` helper. Production builds stay quiet.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | Yes (in practice) | Full GraphQL endpoint, e.g. `http://192.168.1.10:3000/graphql`. Without it, the app falls back to an Expo-hostUri guess and then to a hardcoded LAN IP. |

## Talking to the Backend

- All API calls go through `graphqlRequest` in `constants/api.ts`. It attaches
  the bearer token, sets a 30-second timeout, and normalizes errors.
- File uploads (avatars, BP images) use `lib/graphql-client.ts` for multipart
  GraphQL, then call `uploadImageToS3` (in `utils/upload-image.ts`).
- The AI image-analysis pipeline is in `services/camera.service.ts`:
  `analyzeImage` uploads the photo, then polls `analysisJob(jobId)` until the
  AI service returns `done` or `failed`.

## Testing

There's no automated test suite in `client/` yet. Manual smoke checklist:

1. Register a new account → expect token in SecureStore and home dashboard.
2. Log a manual reading → expect optimistic insert + remote sync (or pending if offline).
3. Capture a BP photo → expect AI status badge and prefilled SYS/DIA/pulse.
4. Toggle airplane mode → make a reading → re-enable network → expect sync.
5. Log out → token is cleared from SecureStore.

## See Also

- [`CLAUDE.md`](./CLAUDE.md) — guidance for AI-assisted development
- [`PLAN.md`](./PLAN.md) — feature backlog + roadmap
- Root [`CLAUDE.md`](../CLAUDE.md) — monorepo-wide context
