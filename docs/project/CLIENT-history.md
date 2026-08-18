---
title: "Client: the history tab"
description: The shipped history screens, the readings layer they sit on, and the export work that closed with them.
status: current
updated: 2026-08-17
owner: client
---

# Client: the history tab

> **Status: the screens have shipped.** `app/(tabs)/history.tsx`,
> `app/history-list.tsx`, and `app/reading/[id].tsx` are real, and **export
> has shipped** — see below.

The readings module it sits on is described in
[CLIENT-home.md](./CLIENT-home.md), "Step 0".

---

## What client-old had

689 lines in the tab, plus a separate list route.

| Section | Verdict |
| --- | --- |
| Time filter tabs (7 / 30 days, 3 months, 1 year) | **Shipped.** The cutoff arithmetic is in `modules/readings/lib/time-filter.ts` and unit-tested, not inline in the screen. |
| — (client-old had no severity filter) | **Shipped anyway**, as FR-03.2's second axis — `modules/readings/lib/severity-filter.ts`. See below. |
| `LineChart` of systolic + diastolic | **Shipped** as `components/bp-trend-chart.tsx`. `react-native-gifted-charts` and `react-native-svg` were already dependencies with no importer — this is what they were for. |
| Reading list, newest first | **Shipped.** `app/history-list.tsx` uses a `FlatList`; client-old rendered every reading into a `ScrollView`. |
| Reading detail modal | **Shipped** as `app/reading/[id].tsx`. Keyed on the reading's `key`, not `remoteId` — a queued reading has no server id and is the one someone is most likely to open, having just saved it. |
| CSV / PDF export + share sheet | **Shipped.** The button exports `visible` — the rows the list is showing, which is the range *and* the severity group — via `useExportReadings`. See [CLIENT-export.md](./CLIENT-export.md). |
| Delete a reading | **Shipped** on the detail route, which client-old had no way to do at all. Server-first for a synced row, local-only for a queued one — see `use-delete-reading.ts`. |
| "เช็กรอบวัดของวันนี้" reminder timeline | **Shipped** as `modules/notifications`' `ReminderTimelineCard`, over a pure `buildReminderTimeline` in `lib/reminder-timeline.ts` (21 tests). See below. |

## Things worth getting right

### The severity filter scopes the list, never the chart

FR-03.2 asks for history filterable by period **or** severity. Both axes ship,
and they do **not** scope the same things:

| | Trend chart | List, "ดูทั้งหมด" count, export |
| --- | --- | --- |
| Time filter | ✅ scopes | ✅ scopes |
| Severity filter | ❌ **never** | ✅ scopes |

The asymmetry is the point, not an inconsistency to tidy away. A trend line
drawn through only the readings that survived a severity filter hides every
reading between them, so selecting "สูง/สูงมาก" would render a patient whose
readings are mostly fine as someone in continuous crisis. A trend's whole
meaning comes from the points the user did *not* single out; a list's does not.
`__test__/screens/history.test.tsx` asserts this directly, in both directions.

**Four pills, not six.** `BPStatus` has five members, and one pill per status
plus "everything" is six controls in a row that has to stay above a 44dp tap
target for this app's audience. `SEVERITY_GROUPS` groups them by what the user
would do about the reading: `normal`, `watch` (`low` + `elevated`), `alert`
(`high` + `critical`). **`low` is in `watch` deliberately** — a scheme built
around the word "high" silently hides hypotension, which is abnormal too. The
groups are a *partition*: every status is in exactly one, and the test asserts
that against `BP_STATUSES`, so a sixth status fails a test rather than becoming
unreachable from every pill.

**No daily bucket, deliberately.** The requirement's wording is daily / weekly
/ monthly against shipped buckets of 7 วัน / 30 วัน / 3 เดือน / 1 ปี. A fifth
time pill would take the row to five while a second filter row now competes for
the same vertical budget, and "today" is already answered better elsewhere:
today's readings are at the top of the 7-day list, and "เช็กรอบวัดของวันนี้"
answers the actual daily question. Revisit if the daily view gets a purpose
beyond "the requirement said daily".

### `history-list.tsx` gets severity and not a period

It gets the severity row because it is the screen with the most rows — finding
the concerning readings by scrolling and reading colour tints is precisely the
task it makes worst. It does **not** get the time row: its title is
"ประวัติทั้งหมด", so re-imposing a period would contradict the screen's own
name and duplicate a control the tab owns one tap away.

The group carries over from the tab as a `severity` route param, so "ดูทั้งหมด"
continues the filter the user chose rather than silently widening it. That
route is reachable by deep link, so the param is untrusted: `parseSeverityFilter`
falls back to "everything" rather than to an empty list, which would read as
data loss.

**Empty states name the culprit.** Two filters stacking makes "ไม่พบรายการ"
useless. On the tab, the severity empty state renders *only* when the range has
rows — which makes severity the sole excluder, so the copy can say so and offer
one tap back; when the range is what is empty, the chart's own empty state has
already said so and a second message would compete with it. On `history-list`
severity is the only filter, so the copy always names it.

### The chart is the reason the list is not enough

A patient looking at history wants the trend, not the rows — the rows are how
they check a specific day. So the chart is above the fold and the list is
below it, which is what client-old did. What client-old also did was compute
`chartLineData` from `readings` with no memo boundary between the filter and
the chart, so changing the time filter re-rendered every row in the list too.
With a `FlatList` and a memoised chart input that stops being true.

### Export shipped here, and on settings

The builders live in `modules/readings/lib/export.ts`, the I/O in
`services/export-file.ts`, and both screens call them through the
`useExportReadings` hook. Full record in [CLIENT-export.md](./CLIENT-export.md).

The split between the two callers is the part worth remembering: **this screen
exports what the list is showing**, `app/settings.tsx` exports everything. The
two filters above the button *are* the period and the severity, which is why
the export asks only for a format. There is a test per axis asserting the
narrowed set is what gets handed over — exporting `readings` instead would give
the user a document covering a period, or a set of severities, they never asked
for while the screen in front of them shows a narrower one.

Two details that were easy to lose in the port, both now covered by tests:

- **The UTF-8 BOM is load-bearing.** Without it Excel opens a Thai CSV as
  mojibake, and the user's conclusion is that the app exported garbage.
- **`resolveExportSubjectName`** picks the patient's name, not the caregiver's,
  when a caregiver is viewing. An export labelled with the wrong person is
  worse than no export — it can end up in front of a doctor.

### The reminder timeline reads the plan, not the settings

`buildReminderTimeline` derives today's rounds from `planReminders(settings)`
rather than from `settings.reminderTimes` directly — the one substantive
change from client-old's version, and the reason it is not a copy.

client-old had no notification budget. This tree does: `schedule-plan.ts`
caps the schedule when a week of reminders would not fit the OS's
64-notification ceiling, so the times the user *requested* and the times that
*fire* are not always the same set. A timeline built from the request would
put a capped-away time on screen against a schedule that never fires it, then
mark it "ค้างวัด" — telling a patient they missed a reminder that was never
sent. Deriving from the plan means the screen and the OS queue cannot
disagree, because they are the same function. There is a test for exactly the
capped case.

Reminder scheduling itself moved from an interval + hour-window formula to a
free-form, alarm-style list of specific times (`ReminderSettings.reminderTimes`
in `modules/notifications/types.ts`) — set individually on `app/reminders.tsx`,
the same interaction as adding an alarm. The budget defence moved with it: the
settings screen refuses to add a time or a day that would push
`reminderTimes.length × selectedDays.length` past the OS ceiling, with an
explanation, rather than accepting it and letting `planReminders` cap it
silently later. The cap in `planReminders` is now a second line of defence for
a settings blob that reached this screen already over budget by some other
path, not the primary mechanism.

Two other things worth not undoing:

- **`now` is a parameter.** The completed / missed / upcoming split is
  entirely a function of the clock, so an internal `new Date()` would make
  none of it assertable. The screen test asserts only the clock-independent
  half for the same reason.
- **The card is hidden while a caregiver is viewing a patient.** Reminder
  settings are device-local and belong to whoever is signed in; the readings
  are the patient's. Rendering both puts two people on one card — the class of
  bug `useSubject` exists to make unrepresentable, arriving through a
  different door because the settings hook is not subject-scoped.

**Left deliberately as the original had it:** a round flips to `missed` the
moment its hour arrives, so the round happening *right now* reads red until it
is answered. "ค้างวัด" is the wrong word for a round that is thirty seconds
old. Fixing it is a copy and status change (a fourth state, or a softer label
for the current round), not a port — noted in the function and worth doing with
the screen in front of you.

---

## What is still open

- ~~**The reminder timeline**~~ Done, above.
- ~~**Signed-URL image resolution.**~~ Done. `app/reading/[id].tsx` resolves a
  server photo through `modules/readings/lib/image-cache.ts`, a 7-day file
  cache keyed on the object path inside the signed URL. See
  [CLIENT-remaining.md](./CLIENT-remaining.md) §1.
