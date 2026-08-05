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

## What is left

1. **The banner on pushed routes** (§2, "still open") — `reading/[id]` and
   `history-list` show patient-scoped data with nothing saying whose.
2. **A-005** (§6) — invite by email as well as phone. Cross-cutting.
3. **C-001** (§4) — blocked on push infrastructure, not on UI work.
