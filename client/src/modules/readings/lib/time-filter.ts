/**
 * The history screen's time ranges.
 *
 * Extracted from `client-old/app/(tabs)/history.tsx`, where the cutoff
 * arithmetic sat inline in a `useCallback`. It is worth its own file because
 * the arithmetic has two edges that are easy to get wrong and impossible to
 * see by looking at the screen:
 *
 *   - **The boundary is inclusive.** A reading taken exactly 7 days ago
 *     belongs in "7 วัน". `>` instead of `>=` silently drops the oldest
 *     reading in every range, which nobody notices until they count.
 *   - **Months and years are calendar arithmetic, not multiplication.**
 *     `setMonth(now.getMonth() - 3)` is not 90 days, and on the 31st it lands
 *     on a month that has no 31st — JavaScript rolls that forward, so
 *     "3 เดือน" taken on 31 May starts on 3 March. Preferred anyway: the user
 *     asked for three months, not ninety days.
 */
import type { Reading } from '../types';

export type TimeFilter = '7days' | '30days' | '3months' | '1year';
/** The export flow adds "everything", which the tab row does not offer. */
export type TimeRange = TimeFilter | 'all';

export const TIME_FILTERS: readonly { key: TimeFilter; label: string }[] = [
  { key: '7days', label: '7 วัน' },
  { key: '30days', label: '30 วัน' },
  { key: '3months', label: '3 เดือน' },
  { key: '1year', label: '1 ปี' },
];

export const DEFAULT_TIME_FILTER: TimeFilter = '30days';

/** The oldest measurement a range includes, or `null` for "everything". */
export function cutoffFor(range: TimeRange, now: Date = new Date()): Date | null {
  if (range === 'all') return null;

  const cutoff = new Date(now);

  switch (range) {
    case '7days':
      cutoff.setDate(now.getDate() - 7);
      break;
    case '30days':
      cutoff.setDate(now.getDate() - 30);
      break;
    case '3months':
      cutoff.setMonth(now.getMonth() - 3);
      break;
    case '1year':
      cutoff.setFullYear(now.getFullYear() - 1);
      break;
  }

  return cutoff;
}

/** Inclusive of the boundary — see the header. */
export function filterByRange(
  readings: Reading[],
  range: TimeRange,
  now: Date = new Date(),
): Reading[] {
  const cutoff = cutoffFor(range, now);
  if (!cutoff) return readings;

  return readings.filter((reading) => reading.measuredAt.getTime() >= cutoff.getTime());
}

/**
 * The last `count` readings in the range, oldest first — what the chart plots.
 *
 * Oldest first because a line chart reads left to right in time, while every
 * list in the app is newest first. Getting this backwards draws the trend
 * mirrored, which looks plausible and is exactly wrong.
 */
export function chartSeries(readings: Reading[], count = 7): Reading[] {
  return [...readings]
    .sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime())
    .slice(-count);
}

/**
 * The chart's y-axis ceiling.
 *
 * Never below 140, so a run of healthy readings does not get drawn as a
 * dramatic mountain range against a 130 ceiling. Above that it rounds up to
 * the next multiple of 20 with 10 of headroom, so the highest point is not
 * flush against the top edge.
 */
export function chartMaxValue(readings: Reading[]): number {
  if (readings.length === 0) return 160;

  const highest = Math.max(
    ...readings.flatMap((reading) => [reading.systolic, reading.diastolic]),
  );
  return Math.max(140, Math.ceil((highest + 10) / 20) * 20);
}
