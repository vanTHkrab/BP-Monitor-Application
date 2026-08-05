# Client: the caregiver role

> **Status: the role works end to end and is instrumented.** A caregiver can
> enter a patient, always sees whose data they are on, switches between
> patients in two taps, is alerted about their patients, and is held to a
> read/write permission the patient chooses when accepting the invite. What is
> left is listed under "What is left, in order" — nothing there blocks the
> role from being usable.
>
> **Both migrations are applied to the Supabase dev database**
> (`prisma migrate status` → up to date). Nothing in this file has been
> exercised on a physical device.

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
| People vs. requests, as two tabs | `app/invitations.tsx` — `TabButtons`, plus a pointer banner so a waiting request is never only behind a tab |
| A person as a card, with their real face | `components/person-card.tsx`; avatars ride on `CaregiverLinkType.caregiverAvatar` / `patientAvatar` |
| "someone asked to be your caregiver" | `hooks/use-invite-alerts.ts` → `modules/notifications` — **local**, not push (§4) |

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

> **This was written before it was true.** The queue and the drain were both
> right; the *listing* between them was not. `listQueuedReadings` matched on
> `pendingReadings.userId`, which for an on-behalf row is the **patient** —
> so the drain, which runs for the signed-in user, never returned the
> caregiver's own captures to them. The reading sat showing "รอซิงก์" forever
> on a device that was online the whole time, and the caregiver is the only
> one holding the photo. Fixed by matching `userId` **or** `recordedById`;
> it has to stay an either/or, because a patient's own readings have
> `recordedById` NULL by design and matching only the actor would strand
> every ordinary reading instead. Three tests in
> `repository/repository.test.ts` pin all three cases.
>
> The reported symptom was the *second* failure behind it:
> `BAD_USER_INPUT — imageId ไม่ถูกต้องหรือไม่ใช่ของคุณ`. `Image.userId` is
> whoever uploaded, the gateway refuses an `imageId` that is not the
> caller's own, and rule 3 in `lib/sync.ts` makes a recorded id sticky — so
> a row carrying an id minted under a different account was rejected
> identically on every pass, permanently, with the numbers held hostage to
> the photo. `lib/sync.ts` now has a **rule 6**: a `BAD_USER_INPUT` on a row
> that has an `imageId` clears the id so the next pass re-uploads under the
> current account. The local file is deliberately *not* cleared with it —
> that is what the re-upload reads from, and dropping both would turn a
> recoverable rejection into a permanently lost photo.

### ~~🔴 The notification bell is not scoped to the patient~~ — fixed, see "Improvement direction" §1 and §2

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

### ~~🔴 A caregiver is never told anything~~ — fixed by the fan-out, see "Improvement direction" §3

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

### Structural limits that blocked new features

Recorded as found. Four of five have since been removed; the table is kept so
the reasoning behind each fix stays attached to the problem it solved.

| Limit | What it blocked | Now |
| --- | --- | --- |
| `CaregiverPatient` had `relationship` + `status` and **no permission column** | "this child may view, this nurse may record" | **Fixed** — Improvement §4: column, split guards, client gate; the patient chooses it on accept (see "What is left" §1, now done). |
| One active patient, switching cost four taps | a caregiver with several patients | **Fixed** — Improvement §5: two taps from the banner |
| `myPatients` returned summaries with **no latest reading** | "all my patients at a glance" was N+1 | **Fixed** — Improvement §6: one grouped query |
| No push infrastructure | every kind of real notification (C-001) | **Still true.** In-app alerts now reach the caregiver (Improvement §3); delivery when the app is closed does not exist. |
| No audit trail beyond `recordedBy` on a reading | who viewed whose data, who removed a link | **Still true**, and untracked elsewhere. For health data this is a real gap, not a nice-to-have — now on the list below as item 6. |

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

**The fan-out itself needed no migration** — `Alert.userId` was already
per-row, so it is just more inserts. The hardening it wanted did get one:
`20260805140000_unique_alert_per_recipient` adds
`@@unique([userId, bpReadingId])`, which is what makes the
`skipDuplicates: true` above actually mean something. It was written after the
fan-out, once a database was reachable — it is defensive rather than urgent,
since a reading is created once and there is no live duplicate path.

The original reasoning:

Two shapes, and the choice matters more than it looks:

| Shape | Gains | Costs |
| --- | --- | --- |
| **A row per recipient** at alert creation | read queries stay as they are; each person owns their own read state | duplicate rows |
| A `subjectUserId` column, read via a join | no duplication | read state is shared — a caregiver marking an alert read marks it read for the patient, which is simply wrong |

**Take the first.** Per-person read state is a correctness requirement; row
duplication is a storage cost, and much the cheaper of the two.

### 4. A permission column on `CaregiverPatient` — **done**

`CaregiverPermission { view, full }`, defaulting to `full` so every existing
row keeps exactly the behaviour it has. Nothing is taken away by the
migration.

**The guard split is the point.** `assertCanActOnBehalfOf` was one check used
for both reading a patient's history and writing into it, which meant any
accepted link could record a blood-pressure value in someone else's medical
record. It is now two:

| Guard | Accepts | Used by |
| --- | --- | --- |
| `assertCanViewPatient` | any accepted link | `readings(patientId:)`, `alerts(patientId:)` |
| `assertCanRecordForPatient` | accepted **and** `full` | `createReading` |

They raise **different messages** on purpose: "you are not linked" and "you
are linked, read-only" are different problems with different fixes, and the
client has to be able to tell them apart. There is a test asserting the two
messages differ, and one asserting the write path never settles for the view
guard.

Since this landed, the patient chooses the value on accept — see "What is
left" §1. Until then every row sat on the default, which made
`assertCanRecordForPatient` a guard that could only ever say yes.

`PatientSummaryType.permission` is exposed so the camera can refuse *before*
the measurement. The gateway refuses either way — the client gate is a
courtesy, never the enforcement — but finding out after framing, capturing and
confirming means the reading the patient just sat through is gone.

Client-side the value parses with an unknown-to-`full` fallback matching the
column default: a client running against an older gateway must not lock every
caregiver out of recording.

**Migration:** `20260805130000_add_caregiver_permission`. Generated with
`prisma migrate diff` against a throwaway Postgres from `infra/`, not with
`migrate dev` — the gateway's `.env` `DATABASE_URL` points at **Supabase**,
and `migrate dev` offers to reset the database it is aimed at. Every migration
in the directory was then replayed against that local Postgres to prove this
one applies, and it has since been applied to Supabase with
`prisma migrate deploy` (see the status table at the end of this file).

The original reasoning:

`permission: view | full` is one small migration today. Once several features
are written on the assumption that "accepted" means "may do everything",
introducing it becomes a rewrite of all of them.

### 5. A quick-switcher in the banner — **done**

`components/patient-switcher-sheet.tsx`, opened by tapping the banner. Two
taps from anywhere in the tabs, against exit → menu → invitations → tap.

Rows lead with the patient's latest reading and sort worst-first. `sortByAttention`
puts a patient with **no** readings above `normal` but below anything
concerning — unknown is not the same as fine. Read-only links are labelled
here too, because finding out you cannot record after switching is a wasted
switch. Both the chevron and the sheet are suppressed for a caregiver with one
patient.

The original reasoning:

Tap the banner → a sheet of linked patients → switch. `ExportFormatSheet` is
the pattern to copy. Four taps become two, and it removes the only reason to
leave the patient's context by hand.

### 6. `myPatients` carries the latest reading — **done**

One grouped `findMany` with `distinct: ['userId']` and a matching `orderBy`,
which is Prisma's "first row per group". Replaces N round trips with one.

The original reasoning:

Makes a caregiver landing screen one query instead of N+1, and is what makes
§5 useful — a switcher that shows who needs attention beats one that lists
names.

---

## What is left, in order

Nothing below blocks the role from being usable. Each item says what it is,
where it goes, and what makes it non-obvious.

### ~~1. Nothing sets `permission`~~ — **done**, the patient grants it on accept

`respondToCaregiverInvite(caregiverId, accept, permission)` now writes the
column, and `InviteDecisionCard` is where the patient answers.

**`addCaregiverPatient` deliberately stayed out of it.** The permission is the
patient's grant, not the caregiver's request — a "requested" permission the
patient then overrides is a value with no consequence, and storing it on the
`pending` row would mean two permissions in one column with only the accept
order to say which is real.

**A GraphQL enum, not a String.** `relationship` takes a String and parses an
unknown value down to `other` (A-004); that is tolerable for a label and not
for this, where the silent fallback would decide who may write into a medical
record. As `CaregiverPermission` the wrong value fails validation before the
resolver runs, so there is no fallback to get wrong. The client's operation
declares `$permission: CaregiverPermission!`, so `verify-graphql` catches a
typo at the gate rather than at runtime.

`permission` defaults to `full` on the argument, matching the column default:
a client from before this change grants exactly what it granted before. It is
written **only on accept** — a rejected row holding a permission nobody
granted is a claim the next accept would have to remember to overwrite.

Client-side, `respondToInvite` makes the argument **required** even though the
gateway defaults it. The gateway's default is for old clients; a current
caller that forgets it would silently grant write access, so the decision is
forced to the call site where the patient's answer actually is.

**The card's copy was load-bearing and had to change with it.** It said
"จะเห็นค่าความดันของคุณ และบันทึกค่าแทนคุณได้" unconditionally, which becomes
a lie the moment a view-only grant is possible.

The card now asks two questions and its layout says so: a tinted identity
header, a titled block of **stacked permission rows**, a divider, then the
yes/no. Each row carries an icon, a label, and a full sentence of what it
grants, with a radio dot on the right — so **both** consequences are on
screen at once, and there is a test asserting it. A control that only
describes the selected option (a segmented control, the first shape this
took) hides the weaker grant from anyone who never taps, which is exactly the
patient this defaults-to-`full` design has to protect.

"ปฏิเสธ" and "อนุญาต" sit on **opposite sides and are different kinds of
button** — outlined versus filled, 1 : 1.6 in width. Two identical buttons in
a row read as "pick either"; this card has a recommended answer and the
weight is what says so. Neither is destructive-red: declining is normal and
reversible by being re-invited, and colouring it as damage pressures the
answer.

**Two contrast fixes came out of this and are not local to the card:**

- **"อนุญาต" was `status.normal`.** White on that green is ~2.9:1, under the
  4.5:1 a button label needs, and it read as washed out in light mode. It is
  `colors.primary` now — which is also what every other primary action in the
  app uses, and stops a colour that means "this BP reading is fine" from
  doubling as "yes".
- **`border-strong` is a new semantic token** (`theme/tokens.js`, both
  modes). The light-mode `border` value *is* the `background` value, which is
  right for a hairline divider and far too faint for the outline of a
  control. `TextField` was worse still: an unfocused field drew
  `colors.surface` — a white border on a white card — so on this very screen
  the phone-number field had no visible edge until it was focused. Both the
  field and this card's unselected option rows now use `border-strong`.
  Existing `border` usages were left alone; the two are not interchangeable
  and a blanket swap would thicken every divider in the app.

Still not covered, and each is its own item rather than a leftover:

- **A patient cannot change the grant after accepting.** The only route from
  `full` to `view` today is remove the link and be re-invited. An
  `updateCaregiverPermission` mutation plus a control on the accepted
  `LinkRow` is the natural shape.
- **Neither side can see what was granted.** `CaregiverLinkType` has no
  `permission` field, so the patient's own link list cannot show it. The
  caregiver sees theirs through `PatientSummaryType.permission`; the patient,
  who made the decision, does not.

### 2. The banner does not cover routes outside `(tabs)`

`ActivePatientBanner` is mounted in `app/(tabs)/_layout.tsx`. `settings`,
`reading/[id]`, `history-list`, and `invitations` are pushed on top and have
their own headers, so a caregiver can be reading someone else's reading detail
with nothing saying whose.

Smaller than it was — you can only reach those from a tab that did show the
banner — but real. `SecurityHeader` is shared by those routes and is the
natural place for a compact variant.

**Watch the safe-area inset.** The tab banner owns `insets.top` and
`_layout.tsx` compensates with a `SafeAreaInsetsContext.Provider` reporting
`top: 0`. A second banner elsewhere needs the same treatment or those screens
gain a double status-bar gap.

### 3. A-005 — invite by email as well as phone

`addCaregiverPatient(patientPhone:)` only. Needs an input object accepting
either, the service lookup, and then
`modules/caregivers/components/invite-form.tsx`. Cross-cutting.

### 4. C-001 — caregiver push notifications, still blocked

Unchanged: **the gateway has no push infrastructure at all.** No token
column, no device registration, nothing that sends. `grep -r "expoPushToken\|pushToken" server/app/api-gateway/src` returns nothing.

The in-app half now works — the fan-out in §3 puts a real alert in the
caregiver's own bell. What is missing is delivery when the app is closed, and
that is gateway work first: token storage, a registration mutation, and a
sender on the alert path. The client preference screen is the small last step.

**A patient-side local notification now exists and is not the same thing.**
`modules/notifications/services/invite-notification.ts` posts a banner when
*this device* first learns of a caregiver request, driven by
`modules/caregivers/hooks/use-invite-alerts.ts`. It fires on a foreground
fetch, so a phone that is asleep learns nothing until the app is opened —
which is precisely the case push exists for. The two look identical when they
work and differ only when the app is closed, so the distinction is worth
keeping in mind when C-001 lands: this becomes the offline path, not the
thing that gets deleted.

Two design points in it that are easy to undo by accident:

- **The announced set is persisted, keyed by user.** Without it every refetch
  of a still-pending request is indistinguishable from a new one, and a
  patient who does not answer immediately is re-notified on every launch and
  every pull-to-refresh.
- **The first list a device sees is a silent baseline**, and the `seeded`
  flag for that is *stored* rather than inferred from an empty set. Inferring
  it means a patient whose first list is empty — the common case on a new
  account — never hears about their first request. There is a test named for
  exactly that.

It deliberately does **not** request notification permission. Asking at the
moment a request happens to arrive is a prompt the user cannot connect to
anything they did, and on Android 13+ a denial there is permanent.

A preference screen before any of that persists a value no system reads —
which is exactly what `app/settings.tsx` refused to port client-old's
"สำรองข้อมูลอัตโนมัติ" switch for.

### 5. An on-behalf row outlives the caregiver's session

Found while fixing the drain, not fixed with it. `clearQueue(db, userId)`
deletes by `userId`, which for a caregiver's on-behalf capture is the
**patient** — so signing the caregiver out leaves the patient's reading, and
the photo it points at, on the caregiver's device with nobody able to send
it. Draining now works for whoever signs in next, which is the right
behaviour when that is the patient and the wrong one when it is a third
account on a shared phone.

Not urgent (the row is inert and the app is single-account at a time) but it
is other people's health data sitting past the session that created it, which
is the category this project treats as load-bearing. The fix mirrors the
listing one: clear on `userId` **or** `recordedById`.

### 6. No audit trail for caregiver access

The only record that anyone acted on a patient's behalf is `recordedBy` on a
reading. Nothing records **who viewed whose history**, who accepted or revoked
a link, or who changed a permission. A caregiver can read a full medical
history and leave no trace, and a revoked link leaves no evidence it ever
existed.

For health data that is a real gap rather than a nice-to-have, and it is the
one item here with no partial implementation to build on. It is also the only
one that gets *worse* with time: an audit log added later cannot reconstruct
what happened before it existed.

Where it goes: the gateway, next to the guards that already know the answer.
`assertCanViewPatient` and `assertCanRecordForPatient` are the single choke
point through which every on-behalf-of access passes — that is what makes this
tractable, and it is an argument for writing it while that is still true.

Non-obvious parts:

- **Writing a log row must not fail the read.** Same reasoning as the alert
  fan-out (Improvement §3) — best-effort and swallowed, or a logging outage
  becomes an outage of the feature it observes.
- **A per-view row is a lot of rows.** `readings(patientId:)` is called on
  every screen mount. Decide up front whether the unit is a *view event* or a
  *session*, and give the table a retention policy in the same change.
- **The log is itself patient data.** Whatever reads it needs its own
  authorization story; do not expose it through the caregiver surfaces.

### 7. Two structural smells worth fixing before they bite again

- **`@/modules/auth`'s barrel imports a native module at import time**
  (`use-google-sign-in` → `@react-native-google-signin`). Anything reaching
  that barrel, however indirectly, cannot load under jest — a pure mapper in
  `modules/caregivers` hit it through two barrels. Worked around with a global
  mock in `jest.setup.js`; the fix is a lazy `require` inside the hook, the
  same shape as the `getDb()` fix in `@/database`.
- **`modules/caregivers` ⇄ `modules/readings` is a cycle** through
  `use-export-readings` → `useSubject`. Three files deep-import
  `readings/lib/status` and `readings/types` to dodge it, each with a comment.
  The cleaner fix is to move `useSubject` somewhere neither module owns —
  it is about "who is the app acting for", which is arguably session state
  rather than caregiver state.

### 8. Nothing here has run on a device

Everything in this file is verified by `pnpm check` and the gateway suite
only. The paths most likely to behave differently on hardware:

- the banner's inset override (visible only on a notched device),
- the switcher and format sheets (Tamagui `Sheet` over a native share sheet),
- the alert fan-out (never run against a real database with real links).

---

## Verification state at handoff

| | |
| --- | --- |
| client `pnpm check` | 43 suites / 520 tests |
| gateway `pnpm test` | 17 suites / 140 tests |
| `verify-graphql` | 45 operations, 0 invalid |
| gateway `pnpm lint` | 7 errors — **pre-existing**, in `auth/android-origin.spec.ts` and `security/dto/passkey-register-verify.input.ts`, untouched by this work |
| Supabase | both migrations applied, schema up to date |

## Things a fresh session should know

- **`src/schema.gql` regenerates only when the app boots.** `nest build`
  compiles without emitting it. `timeout 22 pnpm start` is enough.
- **The gateway's `.env` `DATABASE_URL` points at Supabase.** `prisma migrate
  dev` offers to reset whatever it is aimed at, so migrations here were
  generated with `prisma migrate diff` against a throwaway Postgres from
  `infra/docker-compose` and applied with `migrate deploy`. Host port 5432 was
  already occupied by something outside the project; 55432 was used instead.
- **RNTL v14 `render`, `renderHook`, and `fireEvent` are all async.** A
  missing `await` fails far from the mistake.
- **Tamagui v2 renamed things**: style props are Tailwind-style (`bg`, `px`,
  `items`, `rounded`), `animation` is now `transition`, and colour props take
  theme tokens rather than hex — see `tamagui.config.ts`.
- **Tamagui keeps `Sheet` content mounted while closed.** Asserting a sheet is
  shut by querying for its contents passes for the wrong reason; assert on the
  trigger instead.
