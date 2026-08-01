# Client: what is left after the screen ports

Every screen client-old had now exists here for real, except `app/debug.tsx`.
What remains is smaller than a screen each: features that live *inside* ported
screens, and two pieces of infrastructure the ports worked around.

Bigger items have their own files — [CLIENT-export.md](./CLIENT-export.md),
[CLIENT-debug-tools.md](./CLIENT-debug-tools.md). This is the rest, roughly in
the order the user would notice it missing.

---

## 1. Signed-URL images do not render — only a placeholder

**Where:** `app/reading/[id].tsx`, and anywhere else a fetched reading's photo
should appear.

A reading fetched from the server carries an `s3Key`, not bytes. The detail
screen currently renders the local `imageUri` when there is one and an icon
plus "the photo is on the server" when there is not — which is every reading
taken on another device, and every reading after a reinstall.

client-old solved this with `utils/image-cache.ts` (153 lines) and
`hooks/use-resolved-image-uri.ts` (41): the remote URI renders immediately,
and a `file://` copy swaps in once the download lands, keyed by the extracted
S3 path with a 7-day TTL. The cache is what makes history images work offline
at all; the swap is what stops the signed URL's rotation from breaking an
image mid-view.

**The table for it already exists in the schema** — client-old's
`cached_images`. It is *not* in `database/schema.ts` here, so this needs a
drizzle migration as well as the module. Put it in `modules/readings`
(`repository/image-cache.ts` + `hooks/use-resolved-image-uri.ts`): the cache
is keyed by reading images and nothing else reads it.

## 2. In-app notifications have nowhere to land

**Where:** `modules/notifications`, `app/alerts.tsx`.

client-old's `utils/app-notifications.ts` (108 lines) was an AsyncStorage-backed
queue for alerts surfaced *inside* the app — distinct from
`utils/reminders.ts`, which schedules OS notifications and did get ported
(`modules/notifications`). Server-raised BP alerts render from
`useAlerts()` today, so what is missing is the local queue: anything the app
itself wants to tell the user that is not a scheduled reminder and not a
server alert.

Worth confirming there is a real caller before porting it. If there is not,
this is a delete, not a port.

## 3. The reminder timeline on the history tab

**Where:** `app/(tabs)/history.tsx`, noted in its header comment.

"เช็กรอบวัดของวันนี้" — the section showing which of today's scheduled
measurement rounds have been taken. It needs
`buildReminderTimelineForDate` from client-old's `utils/reminders.ts` (650
lines, of which this is a small part), matched against the day's readings.

The pure part — given a schedule and a list of readings, which rounds are
done — is the whole feature and is unit-testable without a device. Put it in
`modules/notifications/lib/` and let the screen join it against `useReadings`.

## 4. The caregiver's "ดูข้อมูล" jump — **C-005**

**Where:** `app/invitations.tsx`.

Tapping a linked patient should set the viewing context and land on their
data. It was blocked on the home and history tabs being placeholders; both
have landed and both already read `useActivePatient()`, so this is now a
`setActivePatient(patient)` plus a `router.replace('/(tabs)')` — plus deciding
what the tab bar says while a caregiver is inside someone else's history,
which is the part worth thinking about rather than the wiring.

client-old also had an `ActivePatientBanner` above every screen for this. This
tree has no equivalent, and a caregiver who cannot tell whose readings they
are looking at is the failure mode that matters.

## 5. A reducer test for the capture state machine

**Where:** `modules/capture/hooks/use-camera-analysis.ts`.

`framing-state.ts` is tested because it decides when the shutter fires by
itself. The other half — capture → analyse → prefill → save, and the offline
branch — is not, and it is the part that decides whether a reading is
recorded at all. The states are already pure enough to drive without a
camera; what is missing is the harness.

Through the screen harness, assert only what needs no camera: the
permission-denied state, the offline banner, and that manual entry is
reachable when no detector exists.

## 6. Doc drift from the earlier ports

`client/constants/api.ts` and `client/store/slices/` are referenced by
`docs/01-api/API.md`, `infra/README.md`, the api-gateway docs, and the root
`CLAUDE.md`'s "engineering posture" section. Neither path exists in this
tree — GraphQL operations live per-module in `services/*-api.ts`, and there
are no Zustand slices.

Mechanical, but it is the kind of thing that sends the next contributor (or
agent) looking for a file that has not existed for four commits.

## 7. Two board items to reconcile

- **C-004** (`[~]` in `TASK.md`) — "integrate on-device YOLO pre-flight result
  into camera UI warning banner". Superseded: the live framing gate replaced
  the warning-banner design entirely, and it shipped. Close it rather than
  implementing it.
- **C-005** — item 4 above, now unblocked.

`TASK.md` is `bp-task`'s to write; don't edit it by hand.
