# Client: the home tab, and the readings layer under it

> **Status: both steps have shipped.** `modules/readings/` landed in `a2cb8e4`
> and `app/(tabs)/index.tsx` is the real screen. This file is kept as the
> record of *why* it is shaped the way it is, and of what is still deferred —
> see "What is still open" at the end.

Read [CLIENT-auth-structure.md](./CLIENT-auth-structure.md) for the module
layout this builds on. History and camera sit on the same data layer — see
[CLIENT-history.md](./CLIENT-history.md) and
[CLIENT-camera-models.md](./CLIENT-camera-models.md).

---

## Step 0 — the readings module (shipped)

Nothing in this tree read or wrote the `readings` table: it was defined in
[`database/schema.ts`](../../client/src/database/schema.ts), the migrator ran,
and no code touched it. Home's centrepiece is the latest reading and its
status; History is a list of them; Camera's whole purpose is producing one.
All three were blocked on the same missing layer, so it shipped once, on its
own, before any of them.

It is also the highest-blast-radius work left in the client. The root
`CLAUDE.md` names offline-first integrity as a special-attention area for a
reason: partial sync, duplicate sync, and a lost mutex all present as data
loss that only the patient can see.

### What already exists, and is better than client-old's version

The schema is a **two-table split**, not client-old's single overloaded
`pending_readings`:

| Table | Role |
| --- | --- |
| `pendingReadings` | The outbox. Keyed by `clientId`, carries `attempts` + `lastError` so a poison row can be backed off instead of retried forever. |
| `readings` | Mirror of what the server confirmed. Keyed by `remoteId`, with `clientId` kept so a sync confirmation can find the row it promoted. |

client-old made one table do both jobs and distinguished them with a
`syncStatus` column, which is why "mark synced in place" and "stale mirror
drift" are called out as failure modes in the root `CLAUDE.md`. Two tables
make the queue drain a delete-and-insert instead of an in-place mutation, and
the unique index on `readings.client_id` is what stops a double-drain
producing two rows for one measurement. **Do not merge them back.**

### Shape

```text
src/modules/readings/
├── types.ts                 Reading, BPStatus, CreateReadingInput
├── lib/
│   ├── status.ts            sys/dia → BPStatus + threshold table  (+ test)
│   ├── client-id.ts         120-bit id the duplicate guard keys on  (+ test)
│   ├── mappers.ts           GraphQL ⇄ domain ⇄ drizzle row + merge  (+ test)
│   └── sync.ts              the drain, against injected ports       (+ test)
├── repository/
│   ├── queue.ts             pendingReadings: enqueue / list / bump attempts / drop
│   ├── mirror.ts            readings: upsert, promote, prune        (+ test)
│   └── types.ts             the injectable Database handle
├── services/
│   ├── operations.ts        GQL_READINGS, GQL_CREATE_READING, GQL_DELETE_READING
│   ├── readings-api.ts      I/O only
│   └── alert-operations.ts + alerts-api.ts
├── components/              latest-reading-card, guidance-card
├── hooks/                   readings / create / delete / fetch / sync / alerts
│   └── use-readings-sync    app-level push+pull triggers, one provider (+ test)
└── index.ts
```

`use-readings-sync.tsx` is the only thing screens see of either direction.
`useFetchReadings` and `useSyncReadings` are internal to the module: when
screens called them directly, the pull had no trigger outside a
`RefreshControl` (a fresh install showed empty history until someone dragged
the screen down) and every call site registered its own `AppState` and
`NetInfo` listener. `ReadingsSyncProvider` is mounted once in
[`app/_layout.tsx`](../../client/src/app/_layout.tsx), inside the migrations
gate.

### The rules that must survive

`lib/sync.ts` documents five and each has a test; the three below are the
ones that shape the whole module.

1. **The mutex is a promise, not a boolean.** Concurrent callers `return` the
   in-flight promise. A boolean flag lets a second caller skip the drain
   entirely and think it finished. This is stated in client-old's `CLAUDE.md`
   and it was learned the hard way.
2. **Client ids are minted once, by the client.** `createClientId(prefix,
   userId)` — timestamp plus 120 bits. The unique index on
   `readings.client_id` is the last line of defence against a duplicate, and
   it only works if the id is stable across retries.
3. **The read path is `useLiveQuery` over SQLite, not TanStack Query.**
   [`services/query-client.ts`](../../client/src/services/query-client.ts)
   draws this line explicitly: data with a SQLite mirror does not go in the
   query cache, because two caches for one entity update at different times.
   Readings are the case that rule was written for.

### Caregiver context

`activePatientId` belongs to `modules/caregivers`, and home is its first
reader: `readings(patientId:)` on the gateway takes it, and an **accepted**
link is the authorization. It is session-scoped and deliberately not
persisted — reopening the app as a caregiver should land on your own account,
not silently inside someone else's medical history. Tracked as **C-005**;
see "What is still open".

---

## Step 1 — the home screen (shipped)

`client-old/app/(tabs)/index.tsx` was 742 lines. The layout is ported
section-for-section — greeting header with bell, caregiver picker or reading
card, gradient camera CTA, guidance card, "แนวโน้มและรายงาน",
"สุขภาพและการดูแลตัวเอง" — with copy, gradients, radii, and per-status accents
unchanged. Colours resolve through `useTheme()` rather than the hexes the old
screen hardcoded; `theme/tokens.js` is a verbatim port of client-old's
`Theme`, so that renders the same palette while dropping the drift (the old
file used slate `#0F172A` / `#111827` for dark surfaces, which appear nowhere
in `Theme.dark`).

Inventory, and what happened to each part:

| Section | Verdict |
| --- | --- |
| Greeting header | Port. |
| Notification bell + count + modal | Port the bell and count. The modal is a list — make it a route, same reasoning as the comment thread in [`app/post/[id].tsx`](../../client/src/app/post/[id].tsx). |
| Caregiver empty state ("ยังไม่ได้เลือกผู้ป่วย") | Port — it is the entry point for `activePatientId`. |
| Latest reading card + status pill | Port. Needs Step 0. |
| Guidance text keyed by status | Ported into `components/guidance-card.tsx`. It is that card's content, not a property of the classification — a second surface wanting different wording should write its own rather than bend this one. The short one-liner in `lib/status.ts` is separate and used elsewhere. |
| Camera CTA | Port as a link. The camera screen itself is [CLIENT-camera-models.md](./CLIENT-camera-models.md). |
| Emergency call button | Port. `Linking.openURL('tel:1669')`. |
| PDF/CSV report export | **Ported**, back in the original's two-up grid beside "ดูประวัติทั้งหมด". Exports PDF directly — the card says "PDF" on its face, so it does not ask for a format the way settings and history do. See [CLIENT-export.md](./CLIENT-export.md). |
| "เคล็ดลับการดูแลสุขภาพ" row | Ported. `/health-tips` now exists ([`app/health-tips.tsx`](../../client/src/app/health-tips.tsx)); the row opens it. The four tips live in `modules/health-tips/` rather than in the route, since the icon mapping is worth asserting on its own. |

### Alerts

`alerts` / `markAlertRead` / `markAllAlertsRead` back the notification list.
`AlertType.reading` embeds a snapshot of the triggering reading, so the bell
does **not** need a second query — see [API.md §5.5](../01-api/API.md). They
live in `modules/readings/` rather than a module of their own, since
`bpReadingId` is non-null and every alert is about a reading by construction.

The list itself is `app/alerts.tsx`, a route rather than the `<Modal>` it was
in client-old — same call as the comment thread and the reminder settings.

---

## Screen test

Follow [`__test__/screens/settings.test.tsx`](../../client/__test__/screens/settings.test.tsx)
and its harness. Not a snapshot — assert behaviour:

- Renders the latest reading, and the status pill matches what `lib/status.ts`
  computes for those numbers.
- With no readings, shows the empty state rather than a card of dashes.
- A caregiver with no `activePatientId` sees the picker, not somebody's data.
- The emergency button dials, and does so without a confirm — an emergency
  button behind a dialog is not an emergency button.
- The bell's unread count matches the alert list.

`renderScreen` is async — see the traps documented in
[`__test__/test-utils.tsx`](../../client/__test__/test-utils.tsx).

Shipped as [`__test__/screens/home.test.tsx`](../../client/__test__/screens/home.test.tsx),
23 cases. The data hooks are mocked: `useReadings` is a `useLiveQuery` over
expo-sqlite, which cannot run under Jest, and the layer beneath it is already
covered against real migrations in `repository.test.ts`. What is left for a
screen test is what the screen decides — which of two mutually exclusive
states to show, whether the emergency button appears, whether the badge tells
the truth.

---

## What is still open

- **C-005 is half done**, and this screen is the half that works.
  `activePatientId` exists (`modules/caregivers/hooks/use-active-patient.ts`)
  and home branches on it, but nothing *sets* it — so the caregiver gate here
  is currently unreachable rather than merely unused. Scoped in
  [CLIENT-caregiver.md](./CLIENT-caregiver.md); note that home is also the
  **only** screen that says whose data is on it, which the same change needs
  to fix.
- ~~**`/health-tips`** has no route.~~ Done — the screen is ported and the
  home row links to it.
