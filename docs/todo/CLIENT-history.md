# Client: the history tab

`app/(tabs)/history.tsx` is a `ScreenPlaceholder`. So is
`client-old/app/history-list.tsx`, the 160-line "see all" screen behind it.

**Blocked on the readings module** — see
[CLIENT-home.md](./CLIENT-home.md), "Step 0". Everything below assumes it
exists.

---

## What client-old had

689 lines in the tab, plus a separate list route.

| Section | Verdict |
| --- | --- |
| Time filter tabs (7 / 30 / 90 days, all) | Port. Pure date filtering — put the cutoff arithmetic in a tested helper, not inline in the screen. |
| `LineChart` of systolic + diastolic | Port. `react-native-gifted-charts` and `react-native-svg` are **already dependencies of this tree** and currently imported by nothing. |
| Reading list, newest first | Port. Use `FlatList` — client-old rendered every reading into a `ScrollView`. |
| Reading detail modal | Make it a route, `app/reading/[id].tsx`. It shows a photo and has actions; same call as the comment thread. |
| CSV / PDF export + share sheet | Port here, **not** on settings or home. |
| Delete a reading | Port. Confirms, and must remove the row from both the mirror and the queue. |

## Two things worth getting right

### The chart is the reason the list is not enough

A patient looking at history wants the trend, not the rows — the rows are how
they check a specific day. So the chart is above the fold and the list is
below it, which is what client-old did. What client-old also did was compute
`chartLineData` from `readings` with no memo boundary between the filter and
the chart, so changing the time filter re-rendered every row in the list too.
With a `FlatList` and a memoised chart input that stops being true.

### Export belongs here, and it is the last blocked thing

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

Once this ships, delete the "still missing" paragraph from
[`app/settings.tsx`](../../client/src/app/settings.tsx)'s header and the row
in [CLIENT-home.md](./CLIENT-home.md) — per root `CLAUDE.md` rule 6, in the
same change.

---

## Screen test

Harness: [`__test__/test-utils.tsx`](../../client/__test__/test-utils.tsx).
Assert behaviour, not pixels:

- Each time filter shows only readings inside its window, and the boundary
  day is included rather than off by one.
- An empty range says so instead of rendering an empty chart frame.
- Delete asks first, and removes the row from the list on confirm.
- Export produces a file whose CSV body starts with the BOM.

The chart itself is not worth asserting through the renderer — test the
`readings → chart series` transform as a pure function and let the library
draw it.
