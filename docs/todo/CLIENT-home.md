# Client: the home tab, and the readings layer under it

`app/(tabs)/index.tsx` is still a `ScreenPlaceholder`. This is what it takes
to replace it, and why the first half of the work is not the screen.

Read [CLIENT-auth-structure.md](./CLIENT-auth-structure.md) for the module
layout this builds on. History and camera both sit on the same data layer —
see [CLIENT-history.md](./CLIENT-history.md) and
[CLIENT-camera-models.md](./CLIENT-camera-models.md).

---

## Step 0 — the readings module (blocking, and shared)

**Nothing in this tree reads or writes the `readings` table.** It is defined
in [`database/schema.ts`](../../client/src/database/schema.ts), the migrator
runs, and no code touches it. Home's centrepiece is the latest reading and
its status; History is a list of them; Camera's whole purpose is producing
one. All three are blocked on the same missing layer, so it ships once, on
its own, before any of them.

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
│   ├── mappers.ts           GraphQL ⇄ domain ⇄ drizzle row
│   └── sync-plan.ts         which queued rows to attempt, and in what order (+ test)
├── repository/
│   ├── queue.ts             pendingReadings: enqueue / list / bump attempts / drop
│   └── mirror.ts            readings: upsert many, read newest-first, prune
├── services/
│   ├── operations.ts        GQL_READINGS, GQL_CREATE_READING, GQL_DELETE_READING
│   └── readings-api.ts      I/O only
├── hooks/
│   ├── use-readings.ts      useLiveQuery over the mirror — the read path
│   ├── use-create-reading.ts  write → queue → drain
│   └── use-sync-readings.ts   the drain itself, with the mutex
└── index.ts
```

### The three rules that must survive

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

`activePatientId` belongs to `modules/caregivers`, has no reader yet, and
gets one here: `readings(patientId:)` on the gateway takes it, and an
**accepted** link is the authorization. Tracked as **C-005**. Wire it in the
change that ports these tabs, per the note in
[`app/invitations.tsx`](../../client/src/app/invitations.tsx).

---

## Step 1 — the home screen

`client-old/app/(tabs)/index.tsx` is 742 lines. Inventory, and what happens
to each part:

| Section | Verdict |
| --- | --- |
| Greeting header | Port. |
| Notification bell + count + modal | Port the bell and count. The modal is a list — make it a route, same reasoning as the comment thread in [`app/post/[id].tsx`](../../client/src/app/post/[id].tsx). |
| Caregiver empty state ("ยังไม่ได้เลือกผู้ป่วย") | Port — it is the entry point for `activePatientId`. |
| Latest reading card + status pill | Port. Needs Step 0. |
| Guidance text keyed by status | Port. Pure lookup — belongs in `lib/status.ts` next to the thresholds, with a test. |
| Camera CTA | Port as a link. The camera screen itself is [CLIENT-camera-models.md](./CLIENT-camera-models.md). |
| Emergency call button | Port. `Linking.openURL('tel:1669')`. |
| PDF/CSV report export | **Blocked.** Same blocker `app/settings.tsx` documents — the export builders were never ported and there is nothing to export until Step 0 lands. It belongs with History, which is where a user looks for their data. |

### Alerts

`alerts` / `markAlertRead` / `markAllAlertsRead` exist on the gateway and are
already the notification list's source. `AlertType.reading` embeds a snapshot
of the triggering reading, so the bell does **not** need a second query — see
[API.md §5.5](../01-api/API.md). This is small enough to live in
`modules/readings/` rather than earn its own module, since every alert is
about a reading.

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
