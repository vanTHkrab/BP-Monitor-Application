---
title: "Client: CSV and PDF export"
description: Record of the shipped export path, its three callers, and what was ported from client-old.
status: current
updated: 2026-08-07
owner: client
---

# Client: CSV / PDF export

> **Status: shipped.** All three callers are wired, the builders are tested,
> the PDF path has been exercised on a device, and `expo-print` /
> `expo-sharing` now have the imports that justify them.

Ported from client-old's `utils/export-report.ts` (482 lines) and
`utils/export-data.ts` (249). What follows is the record of what landed and
the decisions worth not re-litigating.

---

## Where it lives

| File | What it is |
| --- | --- |
| [`modules/readings/lib/export.ts`](../../client/src/modules/readings/lib/export.ts) | The pure builders: CSV bodies, report HTML, filenames, subject name. No Expo imports — takes a `Reading[]` and returns a string. |
| [`modules/readings/lib/export.test.ts`](../../client/src/modules/readings/lib/export.test.ts) | 30 tests over the above. |
| [`modules/readings/services/export-file.ts`](../../client/src/modules/readings/services/export-file.ts) | The I/O: write the file, open the share sheet. |
| [`modules/readings/hooks/use-export-readings.ts`](../../client/src/modules/readings/hooks/use-export-readings.ts) | What a screen calls. Owns the subject name, the busy flag, and the outcome toast. |
| [`modules/readings/components/export-format-sheet.tsx`](../../client/src/modules/readings/components/export-format-sheet.tsx) | The "PDF or CSV?" sheet, shared by settings and history. |
| [`components/ui/app-toast.tsx`](../../client/src/components/ui/app-toast.tsx) | The app's one toast surface, mounted in `app/_layout.tsx`. |
| [`utils/thai-date.ts`](../../client/src/utils/thai-date.ts) | `formatThaiDate` / `formatThaiDateTime` / `formatFileDate`, with tests. |

Only the hook is on the module's public surface. `services/export-file.ts` is
not: a screen calling it directly would have to resolve the subject name
itself, and getting that wrong files one person's blood pressure under another
person's name.

## What the builders get right

Each of these was learned the hard way in client-old and is now covered by a
test rather than by a comment:

- **A UTF-8 BOM on every CSV.** Without it Excel renders Thai as mojibake, and
  the person opening it is a patient or a clinician, not a developer.
- **`BP-Report_{name}_{period}` filenames.** A share sheet shows the filename
  and nothing else; `export.csv` in a chat thread is unidentifiable a week
  later.
- **The subject is not always the signed-in user.** A caregiver viewing a
  patient exports *that patient's* readings, and the name on the document has
  to match — `resolveExportSubjectName` owns this.
- **The logo is embedded, not linked.** A PDF that fetches an image renders
  blank offline, which is when someone is most likely to be exporting.

## Decisions taken during the port

- **Thai dates are formatted explicitly, not via `toLocaleDateString('th-TH')`.**
  The output of the latter depends on the ICU data the JS engine was built
  with, so Hermes and jest are not guaranteed to agree on the era. A report
  dated 2026 instead of 2569 is wrong in a way nobody thinks to check.
  (`CLIENT-export.md` previously claimed `utils/date-formatter.ts` already had
  Thai helpers — it did not; that file is about the gateway's ISO strings.)
- **The `anonymize` flag is not ported.** It branched every builder and every
  column list, and nothing in this tree offers a way to turn it on. Re-add it
  with the UI that needs it, per root CLAUDE.md rule 13.
- **The community-posts export is not ported.** `buildPostsCsv` /
  `buildPostsPdfHtml` belong to `modules/community` if anyone asks for them.
- **No raw image path in the CSV.** client-old wrote `imageUri`, a `file://`
  path inside this app's sandbox — dead on any other device, in a file whose
  whole purpose is to leave the device. The column reports whether a photo
  exists instead.
- **The SAF / temp-directory fallbacks and the 3-attempt retry loop are gone.**
  They existed because legacy `documentDirectory` can be `undefined`; this
  tree is on the modern `File` / `Directory` / `Paths` API where `Paths.cache`
  is always present, so none of those branches has a trigger.
- **Cache, not document storage.** The share sheet copies the bytes into
  whatever the user picks, so the app has no reason to hold the file
  afterwards.

## The three callers

1. **Home** — the "สร้างรายงานสุขภาพ" card, back in its original two-up grid
   beside "ดูประวัติทั้งหมด" under "แนวโน้มและรายงาน". **Exports PDF directly,
   with no format sheet**: the card says "PDF" on its face, so asking would be
   asking the user to confirm what they just read. This matches client-old.
2. **Settings** — whole-history export, in a "ข้อมูลของฉัน" section placed
   directly above "ลบข้อมูล": someone about to delete their history is exactly
   the person to offer a copy first.
3. **History** — exports `visible`: the rows the list is showing, which is the
   time range **and** the severity group, not everything. The button sits under
   the list, so the document has to be the list — handing over the
   severity-unfiltered set would put normal readings in a report the sheet
   described as "สูง/สูงมาก". The sheet summary names the severity only when
   one is chosen, so the common case does not read "ระดับ ทุกระดับ". There is a
   test per axis.

Settings and history ask for a format through `ExportFormatSheet`. client-old
chained three `Alert`s (data type → period → format); the data-type question
offered posts, which this tree does not export, and the period question asks
the user to restate what the screen already says.

None offers export while `readings.length === 0` — an empty PDF is a worse
answer than a disabled control.

## Dialogs and toasts

The format question is a Tamagui `Sheet`; outcomes are Tamagui toasts. The
split is the rule, not a preference:

- **`Alert` is for decisions.** It is modal — it stops the app and demands a
  tap. Right for "delete this permanently?", wrong for "saved", and actively
  wrong for the export success, which lands while the OS share sheet is
  animating in and would fight it for the screen. `app/settings.tsx`'s delete
  confirm stays on `Alert` for exactly this reason.
- **A sheet can say what it is exporting.** An `Alert` body is one unstyled
  string; the sheet carries the row count, the period, and a line explaining
  what each format is for.
- **It is assertable.** A test presses `export-format-pdf`. The `Alert`
  version could only be tested by invoking the callback at index 0 of
  `Alert.alert`'s mock, which passes just as happily when the buttons are in
  the wrong order.

This is also the first real use of Tamagui in the tree — until now
`TamaguiProvider` was mounted and nothing rendered a Tamagui component. Two
v2 API facts are written up in [`tamagui.config.ts`](../../client/tamagui.config.ts)
because every v1 example online gets them wrong: style props are
Tailwind-style (`bg` / `px` / `items`, not `backgroundColor`), and `animation`
is now `transition`.
