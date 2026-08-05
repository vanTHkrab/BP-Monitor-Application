# Client: the caregiver role

> **Status: the role works end to end.** C-005 and the banner shipped
> together; A-004 is fixed; `myPendingInvites` is gone. What is left is one
> real gap (routes outside the tab navigator), one deferred feature (C-001,
> blocked on infrastructure that does not exist), and A-005.

Scope of this file: everything about acting as, or being seen by, a caregiver.
The module layout it sits on is in
[CLIENT-auth-structure.md](./CLIENT-auth-structure.md); the screens that
consume it are [CLIENT-home.md](./CLIENT-home.md) and
[CLIENT-history.md](./CLIENT-history.md).

---

## What is already real

Verified against the tree, not inferred from the earlier docs:

| Piece | Where |
| --- | --- |
| Link module — invites, patients, links, relationships | `modules/caregivers/` |
| The link screen for both sides | `app/invitations.tsx` |
| Sections derived from data, not role | `lib/sections.ts` (+ test) |
| Session-scoped viewing context | `hooks/use-active-patient.ts` |
| Readings scoped to the viewed patient | `useReadings({ patientId })` — home, history, history-list, reading detail, settings |
| **Recording on a patient's behalf** | `app/(tabs)/camera.tsx:495` passes `patientId` when a caregiver is viewing; `lib/sync.ts` carries it through the offline queue |
| Export attributed to the patient | `resolveExportSubjectName` — see [CLIENT-export.md](./CLIENT-export.md) |

| The way into a patient's data | `app/invitations.tsx` → `setActivePatient` + `router.replace('/(tabs)')` |
| "you are in someone else's account" | `components/active-patient-banner.tsx`, mounted in `app/(tabs)/_layout.tsx` |

Every caregiver operation the gateway exposes is now wired — the one that was
not (`myPendingInvites`) was deleted rather than adopted, see §5. The gateway
remains the real authorization gate: `readings(patientId:)` needs an **accepted** link,
so the client's viewing context only decides what to ask for, never what is
allowed.

---

## 1. The way in — **C-005, done**

`app/invitations.tsx` — tapping a patient calls `setActivePatient(patient)`
then `router.replace('/(tabs)')`. Store first, so the tabs mount already
scoped; `replace` rather than `push`, because the tabs are the destination and
a back gesture landing on the picker while someone else's readings sit behind
it is the confusing half of a modal that should have been a mode switch.

The row stores the **whole `PatientSummary`**, not just the id — the banner
names the patient from it without a second query. The link fallback that
renders before `myPatients` resolves carries no such record, so those rows are
not openable; they become openable a moment later. Opening from them would put
an unnamed patient in the store and render a banner accusing the user of being
in nobody's account.

Grants nothing: `readings(patientId:)` still needs an accepted link on the
gateway, so a tampered client only asks for data it will not receive.

## 2. The banner — **done, and it shipped in the same change**

`modules/caregivers/components/active-patient-banner.tsx`, mounted once in
`app/(tabs)/_layout.tsx` above the navigator.

It is a correctness control rather than a nicety, which is why it was not
allowed to land later: while it is on screen the camera records readings
against `viewingPatientId` and export signs documents with that patient's
name. Both are things nothing downstream can detect as wrong, because both are
exactly what the app was told to do.

**`clearActivePatient` finally has a caller.** It shipped with the store and
nothing used it, so before this a caregiver who entered a patient could only
leave by restarting the app.

One implementation note worth keeping: the banner owns the top safe-area
inset, and several screens apply `paddingTop: insets.top` themselves. They
cannot know something is now above them, so `_layout.tsx` wraps the navigator
in a `SafeAreaInsetsContext.Provider` reporting `top: 0` while a patient is
being viewed. Without it every tab gains a second status-bar gap.

### Still open: routes outside `(tabs)`

The banner covers the five tabs. It does **not** cover `settings`,
`reading/[id]`, `history-list`, or `invitations`, which are pushed on top of
the navigator and have their own headers.

`reading/[id]` and `history-list` both read patient-scoped data, so a
caregiver can still be looking at someone else's reading with nothing saying
so. Smaller than the original gap — you can only reach them from a tab that
did show the banner — but real. The fix is probably a compact variant inside
`SecurityHeader`, which those routes already share.

## 3. `activePatientId` is deliberately not persisted

Not a bug — reopening the app as a caregiver should land on your own account
rather than silently inside someone else's medical history. Documented here so
nobody "fixes" it later. It does mean the banner in §2 can never be the only
exit: a cold start already clears the context.

## 4. Caregiver push notifications — **C-001, deferred on purpose**

**The gateway has no push infrastructure at all.** No push-token column, no
device registration, nothing that sends. Searching `server/app/api-gateway/src`
for `expoPushToken` / `pushToken` returns nothing.

So the board item as written — "wire the caregiver push-notification
preference screen to the store" — cannot be built honestly today. A preference
screen with nothing behind it is a switch that persists a value no system
reads, which is exactly what `app/settings.tsx` refused to port client-old's
"สำรองข้อมูลอัตโนมัติ" toggle for: it claimed to control something that was
not optional and not happening.

The order is gateway first: token storage, a registration mutation, and
something that actually sends on an alert. The client preference is the small
last step, not the first.

`modules/notifications` today schedules **local** reminders only, which is a
different feature and works.

## 5. `myPendingInvites` — **deleted**

Removed from the resolver and the service. `caregiverLinks` plus
`deriveSections` already produce the "waiting on you" group, with a test.

`src/schema.gql` is generated from the resolvers at boot (`autoSchemaFile` in
`app.module.ts`), so it regenerated itself on the next `nest build` / test run
and the query is gone from it too. Nothing hand-edits that file; if a resolver
change ever seems not to reach the schema, run the app rather than editing it.

## 6. Gateway — **A-004 done**, A-005 open

Both are cross-cutting (root `CLAUDE.md` rule 1: gateway and client ship
together, with the reason in the PR body).

- **A-004 — done.** `schema.gql:380` defaults `relationship` to
  `"caregiver"`, which was **not** in `VALID_RELATIONSHIPS`, so every invite
  relying on the default was silently stored as `other` — a 200 and the wrong
  row. Fixed by widening the set rather than changing the default: no schema
  change, so no regeneration and nothing breaks for an existing caller.
  `caregiver` is now a selectable relationship on the client too, since
  offering a value the server rejects is the same class of silent-wrong-row
  bug in the other direction. `patient` stays out — this column says how the
  caregiver relates *to* the patient, and "patient" is not an answer to that.
- **A-005 — invite by phone only.** `addCaregiverPatient` looks a patient up by
  phone. Email would need an input object accepting either, the resolver /
  service lookup, and then the form in
  `modules/caregivers/components/invite-form.tsx`.

---

## Audit — what a full sweep of the four layers found

Swept `client-old/`, `client/`, the gateway resolvers/services, and the Prisma
schema. Two findings were not on any board.

### Parity with client-old is complete, and better in one place

Every caregiver surface client-old had exists here: the link screen, invite
form and decision card, patient list, active patient, the banner, the camera's
"บันทึกให้ คุณ X" line, entry points from menu and profile, and export
attribution.

**One thing is better than the original and was never written down:**
client-old refused caregiver saves while offline —
`camera.tsx:527`, *"Caregiver saves are online-only (no offline queue)"*. Here
they queue like any other reading: `use-create-reading.ts` stores
`recordedById`, and `lib/sync.ts` sends `patientId` back on the drain, so an
on-behalf capture taken on a plane still files under the patient.

### 🔴 The notification bell is not scoped to the patient — shipping today

```
useReadings({ patientId: viewingPatientId })   // scoped
useAlerts()                                    // takes no argument at all
```

A caregiver viewing a patient sees **the patient's readings beside their own
unread alert count**. Two people's data on one screen.

The client cannot fix this alone: `alert.resolver.ts` exposes
`alerts(limit, offset, unreadOnly)` and derives the user from
`@CurrentUser()`. There is no `patientId` argument to pass, unlike
`readings(patientId:)`.

### 🔴 A caregiver is never told anything

`reading.service.ts` creates alerts against the reading's owner, with a comment
that is right as far as it goes:

> *Alerts belong to the reading's owner (the patient) — a critical
> caregiver-recorded value must alert the patient, not the caregiver.*

But the consequence is that `Alert.userId` is **only ever** the patient. A
linked caregiver receives nothing — not a push (there is no push at all), and
not even the in-app bell.

The entire premise of the role is that somebody else is watching. Today the
only way to learn anything is to open the app, enter the patient, and look.
There is no passive path.

### Structural limits that block new features

| Limit | What it blocks |
| --- | --- |
| `CaregiverPatient` has `relationship` + `status` and **no permission column** — accepted means full read *and* write-on-behalf | "this child may view, this nurse may record" is not expressible |
| One active patient, and switching costs four taps (banner exit → menu → invitations → tap) | a professional caregiver with several patients |
| `myPatients` returns summaries with **no latest reading** | any "all my patients at a glance" screen is N+1 queries |
| No push infrastructure — no token column, no registration, no sender | every kind of real notification (C-001) |
| No audit trail beyond `recordedBy` on a reading | who viewed whose data, who removed a link. For health data this is a real gap, not a nice-to-have |

---

## Improvement direction, and why

### 1. Make "whose data am I acting on" one concept — **done**

Shipped as `modules/caregivers/hooks/use-subject.ts`. `useReadings()` and
`useAlerts()` both read it internally and neither takes a `patientId` any
more, so a screen cannot put two subjects on one page. The query cache is
keyed by subject too — a single `['alerts']` key would have served the
caregiver's own alerts from cache the moment they entered a patient.

**Found while wiring it:** `markAlertRead` on the gateway is scoped to the
alert's *owner* (`where: { id, userId }`), so a caregiver's attempt matched no
rows and returned false — a silent no-op the screen rendered as success. That
scoping is correct: read state is the patient's, and letting a caregiver clear
it would hide a critical alert from the person it is about. `useAlerts()` now
exposes `canMarkRead`, and `app/alerts.tsx` hides the controls rather than
offering something that does nothing. The real answer is §3.

The original reasoning, kept because it is the argument for doing the same
thing next time:

**This is the root of the bell bug.** `useReadings` takes a `patientId` and
`useAlerts` does not; nothing makes the two agree, so getting it right is a
thing each screen author has to remember — and eventually does not.

Worse, the parameter is ceremony: all five call sites pass exactly
`viewingPatientId`. A parameter whose only correct value is one expression can
only ever be passed wrongly.

The fix is a single `useSubject()` — `{ subjectId, isSelf, patient }` — that
the data hooks read *internally*, so screens stop passing anything. That makes
the mismatch **unrepresentable** rather than merely discouraged, and every
future hook inherits it.

Do this before adding features, because each new feature otherwise re-decides
the question and can re-introduce the same class of bug.

### 2. Give `alerts` a `patientId` — **done**

`alerts(limit, offset, unreadOnly, patientId)` guards with the same
`assertCanActOnBehalfOf` call `readings(patientId:)` uses. No schema
migration; `schema.gql` regenerated by booting the app, which is the only
thing that regenerates it — `nest build` alone does not.

The original reasoning:

Cheapest possible fix for the bell, and it needs no new thinking about
authorization: `assertCanActOnBehalfOf` already guards `readings(patientId:)`
and applies unchanged. No schema migration.

### 3. Fan alerts out to linked caregivers — **done**

`ReadingService.createAlertForReading` writes the patient's row, then one row
per accepted caregiver via `createMany({ skipDuplicates: true })`. The
caregiver copy is worded differently and leads with the patient's name —
"ค่าความดันของคุณสูงมาก" arriving on somebody else's phone is worse than no
alert at all.

The fan-out is **best-effort and swallowed**: by the time it runs the patient
has been alerted and the reading is saved, so a failed notification must not
surface as a failed save. That swallow is also a trap — the existing service
tests passed with no `caregiverPatient` mock at all, silently exercising
nothing — so the mock is now present in every case with a comment saying why.

Two consequences worth knowing:

- **A caregiver's bell now mixes both kinds.** `AlertReadingType.userId` (the
  patient) is exposed alongside `AlertType.userId` (the recipient); the client
  derives `isAboutSomeoneElse` from the pair, with no extra query and no
  migration. `app/alerts.tsx` switches the row icon on it so the list stays
  scannable.
- **It fixes the read-state problem from §1.** A caregiver now owns a row of
  their own and can legitimately mark it read. `canMarkRead` still gates the
  *other* case — reading a patient's own list through `alerts(patientId:)`,
  where the rows belong to the patient.

**No migration.** `Alert.userId` was already per-row, so fan-out is just more
inserts. A `@@unique([userId, bpReadingId])` would be the natural hardening
and is deliberately **not** here: no database was reachable to run
`prisma migrate dev`, and the repo forbids hand-writing migrations. It is
defensive rather than urgent — a reading is created once, so there is no live
duplicate path — but it should land with the next migration that runs.

The original reasoning:

Two shapes, and the choice matters more than it looks:

| Shape | Gains | Costs |
| --- | --- | --- |
| **A row per recipient** at alert creation | read queries stay as they are; each person owns their own read state | duplicate rows |
| A `subjectUserId` column, read via a join | no duplication | read state is shared — a caregiver marking an alert read marks it read for the patient, which is simply wrong |

**Take the first.** Per-person read state is a correctness requirement; row
duplication is a storage cost, and much the cheaper of the two.

### 4. Add a permission column to `CaregiverPatient` before anything assumes full access

`permission: view | full` is one small migration today. Once several features
are written on the assumption that "accepted" means "may do everything",
introducing it becomes a rewrite of all of them.

### 5. A quick-switcher in the banner

Tap the banner → a sheet of linked patients → switch. `ExportFormatSheet` is
the pattern to copy. Four taps become two, and it removes the only reason to
leave the patient's context by hand.

### 6. `myPatients` should carry the latest reading and its status

Makes a caregiver landing screen one query instead of N+1, and is what makes
§5 useful — a switcher that shows who needs attention beats one that lists
names.

---

## What is left, in order

1. ~~**`useSubject()` + `alerts(patientId:)`**~~ — done.
2. ~~**Alert fan-out**~~ — done. Follow-up: `@@unique([userId, bpReadingId])`
   when a migration can next be run.
3. **The permission column** (§4) — cheap now, a rewrite later.
4. **Quick-switcher + richer `myPatients`** (§5, §6) — UX and scale.
5. **The banner on pushed routes** (§2, "still open") — `reading/[id]` and
   `history-list` show patient-scoped data with nothing saying whose.
6. **A-005** (§6 gateway) — invite by email as well as phone.
7. **C-001** — blocked on push infrastructure, not on UI work.

Items 2, 3, 4 and 6 are cross-cutting: gateway and client ship together with
the reason in the PR body (root `CLAUDE.md` rule 1).
