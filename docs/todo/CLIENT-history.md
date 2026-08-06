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
| `LineChart` of systolic + diastolic | **Shipped** as `components/bp-trend-chart.tsx`. `react-native-gifted-charts` and `react-native-svg` were already dependencies with no importer — this is what they were for. |
| Reading list, newest first | **Shipped.** `app/history-list.tsx` uses a `FlatList`; client-old rendered every reading into a `ScrollView`. |
| Reading detail modal | **Shipped** as `app/reading/[id].tsx`. Keyed on the reading's `key`, not `remoteId` — a queued reading has no server id and is the one someone is most likely to open, having just saved it. |
| CSV / PDF export + share sheet | **Shipped.** The button exports `filtered` — the range the time filter is showing — via `useExportReadings`. See [CLIENT-export.md](./CLIENT-export.md). |
| Delete a reading | **Shipped** on the detail route, which client-old had no way to do at all. Server-first for a synced row, local-only for a queued one — see `use-delete-reading.ts`. |
| "เช็กรอบวัดของวันนี้" reminder timeline | **Shipped** as `modules/notifications`' `ReminderTimelineCard`, over a pure `buildReminderTimeline` in `lib/reminder-timeline.ts` (21 tests). See below. |

## Two things worth getting right

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
exports the filtered range**, `app/settings.tsx` exports everything. The time
filter above the button *is* the period, which is why the export asks only for
a format. There is a test asserting the filtered set is what gets handed over —
exporting `readings` instead of `filtered` would give the user a document
covering a period they never asked for while the screen in front of them shows
a narrower one.

Two details that were easy to lose in the port, both now covered by tests:

- **The UTF-8 BOM is load-bearing.** Without it Excel opens a Thai CSV as
  mojibake, and the user's conclusion is that the app exported garbage.
- **`resolveExportSubjectName`** picks the patient's name, not the caregiver's,
  when a caregiver is viewing. An export labelled with the wrong person is
  worse than no export — it can end up in front of a doctor.

### The reminder timeline reads the plan, not the settings

`buildReminderTimeline` derives today's rounds from `planReminders(settings)`
rather than from `settings.intervalHours` — the one substantive change from
client-old's version, and the reason it is not a copy.

client-old had no notification budget. This tree does: `schedule-plan.ts`
widens the interval when a week of reminders would not fit the OS's
64-notification ceiling, so the interval the user *requested* and the interval
that *fires* are not always the same number. A timeline built from the request
would put 09:00 on screen against a schedule firing 07:00 / 11:00, then mark
it "ค้างวัด" — telling a patient they missed a reminder that was never sent.
Deriving from the plan means the screen and the OS queue cannot disagree,
because they are the same function. There is a test for exactly the thinned
case.

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
