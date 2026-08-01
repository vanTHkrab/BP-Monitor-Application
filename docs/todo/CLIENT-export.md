# Client: CSV / PDF export

The one feature client-old shipped that this tree still cannot do at all.
Two screens have a hole where its button was — `app/settings.tsx` and
`app/(tabs)/history.tsx` — and both say so in their header comments.

**No longer blocked.** It was waiting on there being readings to export;
the readings module, home, history, and camera tabs have all landed.

---

## The state this tree is in

`expo-print` and `expo-sharing` are in `client/package.json` and **imported by
nothing**. That violates root CLAUDE.md rule 13 today, and it is the reason
this task has a deadline of sorts: either the export lands and justifies them,
or they come out. Don't let a third state — "we'll use it later" — persist.

What has to be written:

| client-old | lines | what it is |
| --- | --- | --- |
| `utils/export-report.ts` | 482 | The pure builders: CSV bodies, report-style PDF HTML, filenames |
| `utils/export-data.ts` | 249 | The I/O: write the file, hand it to the share sheet |

Everything they depend on already exists here: `useReadings` returns the
merged mirror + queue, `lib/time-filter.ts` has the range filters the export
periods use, `utils/date-formatter.ts` has the Thai date helpers, and
`modules/caregivers` knows whose data is on screen.

## What the builders have to get right

These are the details that make an export a document rather than a dump, and
each one was learned the hard way in client-old:

- **A UTF-8 BOM on every CSV.** Without it Excel renders Thai as mojibake, and
  the person who opens it is a patient or a clinician, not a developer.
- **`BP-Report_{name}_{period}` filenames.** A share sheet shows the filename
  and nothing else; `export.csv` in a chat thread is unidentifiable a week
  later.
- **The subject is not always the signed-in user.** A caregiver viewing a
  patient exports *that patient's* readings, and the name in the file has to
  match — client-old had `resolveExportSubjectName` for exactly this. Getting
  it wrong attributes one person's blood pressure to another.
- **The logo is embedded, not linked.** A PDF that fetches an image renders
  blank offline, which is when someone is most likely to be exporting.

## Where it goes

`src/modules/readings/lib/export.ts` for the builders and
`src/modules/readings/services/export-file.ts` for the I/O, exported through
the module's `index.ts`. It is readings data, shaped for readings screens; a
top-level `utils/` entry would be the client-old layout, not this one.

The builders are pure and take a `Reading[]` — that is what makes them
testable, and this is output someone may hand to a doctor, so they should be
tested (BOM present, header row, Thai dates, the caregiver subject name, an
empty range producing a valid empty file rather than a crash).

## Two callers

1. **Settings** — the section the port left out. Whole-history export.
2. **History** — the button next to the time filter, exporting the range
   currently on screen. Note that the filter is already applied to
   `filtered`; export what the user is looking at, not what they last picked.

Neither should offer export while `readings.length === 0`. An empty PDF is a
worse answer than a disabled button.
