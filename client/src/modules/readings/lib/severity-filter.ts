/**
 * The history screen's severity axis — the second half of FR-03.2's
 * "filterable by period **or** by severity".
 *
 * Separate from `time-filter.ts` on purpose: the two axes stack, but they do
 * not scope the same things. Time scopes the chart *and* the list; severity
 * scopes the list only. See the comment on `visible` in
 * `app/(tabs)/history.tsx` for why.
 *
 * ## Why four pills and not six
 *
 * `BPStatus` has five members, so one pill per status plus "everything" is
 * six controls in a row that already has to stay reachable for an elderly
 * user with a 44dp floor. Six either wrap or shrink below that floor. The
 * question a user actually asks is nearer "show me the ones that weren't
 * fine" than "show me exactly the `elevated` ones", so the statuses are
 * grouped by what the user would do about them:
 *
 *   - `normal` — nothing to do.
 *   - `watch`  — off-normal, re-measure and keep an eye on it. This is where
 *     **`low` lives**, and it is the reason the grouping is not built around
 *     the word "high": a scheme with a `high`/`critical` pill and nothing
 *     else silently hides hypotension, which is abnormal too.
 *   - `alert`  — the band that gets acted on, `high` and `critical`.
 *
 * `SEVERITY_GROUPS` is a **partition**: every `BPStatus` appears in exactly
 * one group. Overlapping groups (an "abnormal" pill that also contains the
 * "alert" pill's rows) would put one reading under two mutually exclusive
 * pills, which is a lie in a single-select row. `severity-filter.test.ts`
 * asserts the partition holds, so adding a sixth status fails a test rather
 * than falling silently into no group at all.
 */
import type { BPStatus, Reading } from '../types';

/** `all` is the escape hatch; the rest are the groups below. */
export type SeverityFilter = 'all' | 'normal' | 'watch' | 'alert';

/** Every filter that actually narrows. */
export type SeverityGroup = Exclude<SeverityFilter, 'all'>;

/** A partition of `BPStatus` — see the header. Enforced by a test. */
export const SEVERITY_GROUPS: Record<SeverityGroup, readonly BPStatus[]> = {
  normal: ['normal'],
  watch: ['low', 'elevated'],
  alert: ['high', 'critical'],
};

/**
 * `accessibilityLabel` exists because two of the labels are shorter than what
 * they mean: "เฝ้าระวัง" does not announce that it contains low readings, and
 * a screen-reader user gets no colour tint to infer it from.
 */
export const SEVERITY_FILTERS: readonly {
  key: SeverityFilter;
  label: string;
  accessibilityLabel?: string;
}[] = [
  { key: 'all', label: 'ทุกระดับ', accessibilityLabel: 'ทุกระดับความดัน' },
  { key: 'normal', label: 'ปกติ', accessibilityLabel: 'เฉพาะค่าปกติ' },
  { key: 'watch', label: 'เฝ้าระวัง', accessibilityLabel: 'เฝ้าระวัง ความดันต่ำหรือค่อนข้างสูง' },
  { key: 'alert', label: 'สูง/สูงมาก', accessibilityLabel: 'ความดันสูงหรือสูงมาก' },
];

export const DEFAULT_SEVERITY_FILTER: SeverityFilter = 'all';

const SEVERITY_KEYS = SEVERITY_FILTERS.map((filter) => filter.key);

/**
 * Narrows an untrusted string — a route param on `/history-list`, which is
 * reachable by deep link and therefore not this app's to trust. An
 * unrecognised value falls back to "everything" rather than to an empty list,
 * because a screen showing nothing reads as data loss.
 */
export function parseSeverityFilter(value: string | string[] | undefined): SeverityFilter {
  const first = Array.isArray(value) ? value[0] : value;
  return SEVERITY_KEYS.includes(first as SeverityFilter)
    ? (first as SeverityFilter)
    : DEFAULT_SEVERITY_FILTER;
}

export function matchesSeverity(status: BPStatus, filter: SeverityFilter): boolean {
  if (filter === 'all') return true;
  return SEVERITY_GROUPS[filter].includes(status);
}

export function filterBySeverity(readings: Reading[], filter: SeverityFilter): Reading[] {
  if (filter === 'all') return readings;
  return readings.filter((reading) => matchesSeverity(reading.status, filter));
}

/** The pill's own words, for empty-state copy that has to name the culprit. */
export function severityFilterLabel(filter: SeverityFilter): string {
  return SEVERITY_FILTERS.find((entry) => entry.key === filter)?.label ?? '';
}
