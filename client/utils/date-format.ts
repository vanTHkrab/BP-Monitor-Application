// Shared Thai date formatting for UI and export surfaces.
//
// The app's existing convention (reading-detail-modal, home feed, chat) is
// `Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })`
// which renders a Buddhist-era year with abbreviated Thai months, e.g.
// "10 ก.ค. 2569 21:52". These helpers hand-roll the same output so the
// result is deterministic across Hermes / Node / Jest regardless of which
// ICU data is bundled. Keep the output in sync with that Intl style —
// don't introduce a third format.

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
] as const;

const toDate = (value: Date | string | number): Date | null => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/** "10 ก.ค. 2569" — abbreviated Thai month, Buddhist-era year. */
export const formatThaiDate = (value: Date | string | number): string => {
  const date = toDate(value);
  if (!date) return '-';
  return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear() + 543}`;
};

/** "10 ก.ค. 2569 21:52" — matches the reading-detail-modal style. */
export const formatThaiDateTime = (value: Date | string | number): string => {
  const date = toDate(value);
  if (!date) return '-';
  return `${formatThaiDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/**
 * "20260710" — compact Gregorian date for filenames. Gregorian (not
 * Buddhist) so exported files sort chronologically next to other
 * ISO-dated files on the receiving device.
 */
export const formatFileDate = (value: Date | string | number): string => {
  const date = toDate(value);
  if (!date) return 'unknown';
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
};
