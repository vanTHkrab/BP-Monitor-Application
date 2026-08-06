import {
  DEFAULT_SEVERITY_FILTER,
  SEVERITY_FILTERS,
  SEVERITY_GROUPS,
  filterBySeverity,
  matchesSeverity,
  parseSeverityFilter,
  severityFilterLabel,
  type SeverityGroup,
} from './severity-filter';
import { BP_STATUSES } from './status';
import type { BPStatus, Reading } from '../types';

const reading = (status: BPStatus, key = `k-${status}`): Reading => ({
  key,
  userId: 'u1',
  systolic: 120,
  diastolic: 78,
  pulse: 70,
  measuredAt: new Date(2026, 6, 29, 12, 0, 0),
  status,
  createdAt: new Date(2026, 6, 29, 12, 0, 0),
  syncState: 'synced',
});

const GROUPS = Object.keys(SEVERITY_GROUPS) as SeverityGroup[];

describe('SEVERITY_GROUPS', () => {
  /**
   * The load-bearing property. `BP_STATUSES` is derived from a
   * `Record<BPStatus, string>`, so a sixth status cannot be added to the type
   * without appearing here — and if it is not also put in a group, this fails
   * rather than silently becoming unreachable from every pill.
   */
  it('is a partition of BPStatus — every status in exactly one group', () => {
    const grouped = GROUPS.flatMap((group) => SEVERITY_GROUPS[group]);

    expect([...grouped].sort()).toEqual([...BP_STATUSES].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  // The failure this guards is the one the brief calls out by name: a scheme
  // built around the word "high" leaves hypotension with no pill at all.
  it('puts low in a group rather than orphaning it', () => {
    expect(SEVERITY_GROUPS.watch).toContain('low');
  });

  it('keeps the acted-on band together and apart from the watch band', () => {
    expect(SEVERITY_GROUPS.alert).toEqual(['high', 'critical']);
    expect(SEVERITY_GROUPS.watch).not.toContain('critical');
  });
});

describe('SEVERITY_FILTERS', () => {
  it('offers "all" plus one pill per group, and no more', () => {
    expect(SEVERITY_FILTERS.map((filter) => filter.key)).toEqual(['all', ...GROUPS]);
  });

  // Four is the row width the time filter already ships at; six pills drop the
  // tap targets below the 44dp floor this app's audience needs.
  it('stays at four pills', () => {
    expect(SEVERITY_FILTERS).toHaveLength(4);
  });

  it('has Thai copy for every pill', () => {
    SEVERITY_FILTERS.forEach((filter) => {
      expect(filter.label).toMatch(/[฀-๿]/);
    });
  });

  // Two of the labels are shorter than what they mean, and a screen-reader
  // user gets no colour tint to infer the rest from.
  it('spells out the grouped pills for screen readers', () => {
    const watch = SEVERITY_FILTERS.find((filter) => filter.key === 'watch');

    expect(watch?.accessibilityLabel).toMatch(/ต่ำ/);
  });
});

describe('matchesSeverity', () => {
  it.each(BP_STATUSES)('lets %s through the "all" filter', (status) => {
    expect(matchesSeverity(status, 'all')).toBe(true);
  });

  it.each([
    ['low', 'watch'],
    ['normal', 'normal'],
    ['elevated', 'watch'],
    ['high', 'alert'],
    ['critical', 'alert'],
  ] as const)('lands %s in the %s group and nowhere else', (status, expected) => {
    GROUPS.forEach((group) => {
      expect(matchesSeverity(status, group)).toBe(group === expected);
    });
  });
});

describe('filterBySeverity', () => {
  const all = BP_STATUSES.map((status) => reading(status));

  it('returns the input untouched for "all"', () => {
    expect(filterBySeverity(all, 'all')).toBe(all);
  });

  it('keeps only the group members', () => {
    expect(filterBySeverity(all, 'alert').map((row) => row.status)).toEqual(['high', 'critical']);
  });

  it('reads the stored status, not a re-classification of the numbers', () => {
    // Every row above carries 120/78, which `classifyReading` calls `normal`.
    // Filtering on the numbers instead of the column would put all five in the
    // "ปกติ" pill — and a reading stored by an older build with different
    // thresholds must keep filtering the way it renders.
    expect(filterBySeverity(all, 'normal')).toHaveLength(1);
  });

  it('returns an empty list rather than throwing when nothing matches', () => {
    expect(filterBySeverity([reading('normal')], 'alert')).toEqual([]);
  });
});

describe('parseSeverityFilter', () => {
  it('passes a known group through', () => {
    expect(parseSeverityFilter('alert')).toBe('alert');
  });

  // The route param is reachable by deep link, so it is not this app's to
  // trust. Falling back to an empty list would read as data loss.
  it.each([['nonsense'], [''], [undefined], ['__proto__']])(
    'falls back to "all" for %p',
    (value) => {
      expect(parseSeverityFilter(value)).toBe(DEFAULT_SEVERITY_FILTER);
      expect(DEFAULT_SEVERITY_FILTER).toBe('all');
    },
  );

  it('takes the first value when the router hands over a repeated param', () => {
    expect(parseSeverityFilter(['watch', 'alert'])).toBe('watch');
  });
});

describe('severityFilterLabel', () => {
  it('gives the empty-state copy the pill\'s own words', () => {
    expect(severityFilterLabel('alert')).toBe('สูง/สูงมาก');
  });
});
