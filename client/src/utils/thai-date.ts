/**
 * Thai-calendar display formatting.
 *
 * Separate from `date-formatter.ts`, which is about the strict `YYYY-MM-DD`
 * strings the gateway's `DateTime` scalar parses. This file is the opposite
 * direction: dates on their way to a human.
 *
 * ## Why not `toLocaleDateString('th-TH')`
 *
 * Several screens format Thai dates inline that way and it renders fine.
 * These exports do not use it, on purpose:
 *
 *   - **Determinism.** The output depends on the ICU data the JS engine was
 *     built with. Hermes on a phone and Node in jest are not guaranteed to
 *     agree on abbreviation or era, so a unit test asserting on an exported
 *     CSV would be asserting on the runtime's locale database rather than on
 *     this app. These exports go into a file someone may hand to a clinician;
 *     the format should not be able to shift under it.
 *   - **The Buddhist era is not optional here.** `th-TH` happens to default
 *     to the Buddhist calendar in full-ICU builds, and silently does not in a
 *     small-ICU build. A report dated 2026 instead of 2569 is wrong in a way
 *     nobody would think to check.
 *
 * Noticed but deliberately not changed: `modules/readings/components/`
 * (`bp-reading-card`, `latest-reading-card`) and `app/reading/[id].tsx` each
 * carry their own local `toLocaleDateString('th-TH')` formatter. Converging
 * them on this file is a real cleanup, but it is not this change (root
 * CLAUDE.md rule 2) — and unlike an export, a mis-abbreviated month on a card
 * is cosmetic.
 */

const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

/** The offset from the Gregorian year to the Buddhist Era. */
const BUDDHIST_ERA_OFFSET = 543;

const pad2 = (value: number): string => String(value).padStart(2, '0');

const isValidDate = (date: Date): boolean => !Number.isNaN(date.getTime());

/** `"10 ก.ค. 2569"`. Returns `"-"` for an unusable date rather than throwing. */
export function formatThaiDate(date: Date): string {
  if (!isValidDate(date)) return '-';
  return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${
    date.getFullYear() + BUDDHIST_ERA_OFFSET
  }`;
}

/** `"10 ก.ค. 2569 21:52"` — the reading-detail style, with 24-hour time. */
export function formatThaiDateTime(date: Date): string {
  if (!isValidDate(date)) return '-';
  return `${formatThaiDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * `"20260710"` — compact date for filenames.
 *
 * **Gregorian, not Buddhist**, unlike everything else here. A filename is
 * read by a file manager, not by a person reading Thai: exported files should
 * sort chronologically alongside whatever else is in the folder, and a 2569
 * prefix sorts after every other file on the device forever.
 */
export function formatFileDate(date: Date): string {
  if (!isValidDate(date)) return 'unknown';
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}
