# Client: the caregiver role

> **Status: the plumbing shipped, the way *in* did not.** A caregiver can be
> linked to a patient, and every screen already scopes its data to whoever is
> being viewed — but nothing in the app *sets* who that is, and only one screen
> tells the user whose data is on it.

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

Five of the gateway's six caregiver operations are wired. The gateway remains
the real authorization gate: `readings(patientId:)` needs an **accepted** link,
so the client's viewing context only decides what to ask for, never what is
allowed.

---

## 1. The way in does not exist — **C-005**

**Where:** `app/invitations.tsx` (its header still says "Not ported").

Tapping a linked patient should set the viewing context and land on their
data. It is now pure wiring — `setActivePatient(patient)` plus
`router.replace('/(tabs)')` — because home and history already read
`useActivePatient()` and both render a "pick a patient" gate until one is set.

Until this lands, **caregiver mode is unreachable from the UI**: every screen
is built for it and no user can enter it.

## 2. Nothing says whose data is on screen

**Where:** every screen except home.

`app/(tabs)/index.tsx` renders one line — "กำลังดูข้อมูลของคุณ …". History,
camera, settings, history-list, and reading detail all scope their queries to
`viewingPatientId` and show nothing at all.

client-old had an `ActivePatientBanner` above every screen. This tree has no
equivalent, and **this is now a data-correctness problem rather than a polish
one**: export attributes the document to the active patient
([CLIENT-export.md](./CLIENT-export.md)), and the camera records readings
against them. A caregiver who has forgotten they are inside someone else's
account can file a measurement, or hand a doctor a PDF, under the wrong name.

Ship this **with C-005**, not after it. The moment the jump exists, so does the
failure mode.

Worth deciding while building it: what the tab bar says while a caregiver is
inside someone else's history, and how they get *out*. `clearActivePatient`
exists and nothing calls it.

## 3. `activePatientId` is deliberately not persisted

Not a bug — reopening the app as a caregiver should land on your own account
rather than silently inside someone else's medical history. Documented here so
nobody "fixes" it later. It does mean the banner in §2 can never be the only
exit: a cold start already clears the context.

## 4. Caregiver push-notification preference — **C-001**

On the board, unstarted. Nothing in `modules/notifications` distinguishes a
reminder for yourself from an alert about someone you care for.

## 5. `myPendingInvites` is unused server surface

The gateway exposes three caregiver queries; the client uses two.
`caregiverLinks` plus `deriveSections` already produces the "waiting on you"
group that `myPendingInvites` was presumably for.

Decide rather than leave it: either the client should use it (one query instead
of client-side derivation) or it is dead surface on the gateway. Both are fine;
the current state — a resolver nobody calls — is the one that is not.

## 6. Two gateway bugs that surface here — **A-004**, **A-005**

Both are cross-cutting (root `CLAUDE.md` rule 1: gateway and client ship
together, with the reason in the PR body).

- **A-004 — the invite default is unusable.** `schema.gql:380` defaults
  `relationship` to `"caregiver"`, which is **not** in `VALID_RELATIONSHIPS`
  (`caregiver.service.ts:34`), so `parseRelationship` silently stores `other`.
  Prisma's `RelationshipType` has both `caregiver` and `patient`; the schema
  default and the accepted set have to agree on one authoritative list.
  The client works around it today by making relationship a picker rather than
  free text, so the default is rarely hit — which is exactly why it has
  survived.
- **A-005 — invite by phone only.** `addCaregiverPatient` looks a patient up by
  phone. Email would need an input object accepting either, the resolver /
  service lookup, and then the form in
  `modules/caregivers/components/invite-form.tsx`.

---

## Order worth doing it in

1. **C-005 + the banner together** (§1 + §2). One is unreachable without the
   other; the second is what stops the first from being dangerous.
2. **§5**, five minutes of deciding, then either a small client change or a
   gateway deletion.
3. **A-004** (§6) — a real correctness bug, cheap, and independent of the UI.
4. **C-001** (§4) and **A-005** (§6) — features, not debt.
