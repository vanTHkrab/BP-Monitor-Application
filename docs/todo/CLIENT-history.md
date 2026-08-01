# Client: the history tab

> **Status: the screens have shipped.** `app/(tabs)/history.tsx`,
> `app/history-list.tsx`, and `app/reading/[id].tsx` are real. **Export has
> not** — see "What is still open".

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
| CSV / PDF export + share sheet | **Not ported.** See below. |
| Delete a reading | **Shipped** on the detail route, which client-old had no way to do at all. Server-first for a synced row, local-only for a queued one — see `use-delete-reading.ts`. |
| "เช็กรอบวัดของวันนี้" reminder timeline | **Not ported** — needs `buildReminderTimelineForDate` from client-old's `utils/reminders.ts`, which has no equivalent in `modules/notifications`. |

## Two things worth getting right

### The chart is the reason the list is not enough

A patient looking at history wants the trend, not the rows — the rows are how
they check a specific day. So the chart is above the fold and the list is
below it, which is what client-old did. What client-old also did was compute
`chartLineData` from `readings` with no memo boundary between the filter and
the chart, so changing the time filter re-rendered every row in the list too.
With a `FlatList` and a memoised chart input that stops being true.

### Export belongs here, and it is what is left

`app/settings.tsx` documents the export blocker in its header, and
[CLIENT-home.md](./CLIENT-home.md) defers it to this screen. The builders in
client-old (`utils/export-report.ts` — CSV with a UTF-8 BOM, report-style PDF
HTML, `BP-Report_{name}_{period}` filenames) are pure functions and port
cleanly. Two details that are easy to lose:

- **The UTF-8 BOM is load-bearing.** Without it Excel opens a Thai CSV as
  mojibake, and the user's conclusion is that the app exported garbage.
- **`resolveExportSubjectName`** picks the patient's name, not the caregiver's,
  when a caregiver is viewing. An export labelled with the wrong person is
  worse than no export — it can end up in front of a doctor.

It is its own change: ~730 lines of pure builders plus two new dependencies
(`expo-print`, `expo-sharing`), none of which the screens above needed. Once
it ships, delete the "still missing" paragraph from
[`app/settings.tsx`](../../client/src/app/settings.tsx)'s header, the export
row in [CLIENT-home.md](./CLIENT-home.md), and the note in
`app/(tabs)/history.tsx`'s header — per root `CLAUDE.md` rule 6, in the same
change.

---

## Screen test

Harness: [`__test__/test-utils.tsx`](../../client/__test__/test-utils.tsx).
Behaviour, not pixels. Shipped as [`__test__/screens/history.test.tsx`](../../client/__test__/screens/history.test.tsx),
12 cases, plus 15 on the range arithmetic in
`modules/readings/lib/time-filter.test.ts`:

- Each time filter shows only readings inside its window, and the boundary day
  is **included** — `>` instead of `>=` silently drops the oldest reading in
  every range and nobody notices until they count.
- The three "no chart" situations say three different things: no readings at
  all, none in this range, still loading. One message for all three sends the
  user looking for a bug that is not there.
- The preview really is capped at three, and "ดูทั้งหมด" appears only when
  something is hidden.
- The caregiver gate holds, and never fires for a patient account.

The chart is not asserted through the renderer — its input is tested as a pure
function and how `react-native-gifted-charts` draws it is that library's
business. Export's assertions stay in the list above for whoever ships it.

---

## What is still open

- **CSV / PDF export.** The one section of the original that has no equivalent
  here. See "Export belongs here" above for the two details that are easy to
  lose when porting the builders.
- **The reminder timeline** ("เช็กรอบวัดของวันนี้"). Blocked on
  `buildReminderTimelineForDate`, which `modules/notifications` does not have.
- **Signed-URL image resolution.** `app/reading/[id].tsx` renders a local
  `imageUri` but can only *say* that a server-side photo exists when all it
  has is an `s3Key` — client-old resolved those through a 7-day file cache
  (`utils/image-cache.ts`), which is not ported. Ships with the camera work:
  see [CLIENT-camera-models.md](./CLIENT-camera-models.md).
