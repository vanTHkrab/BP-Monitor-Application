import { chartMaxValue, chartSeries, cutoffFor, filterByRange } from './time-filter';
import type { Reading } from '../types';

const NOW = new Date(2026, 6, 29, 12, 0, 0); // 29 July 2026, local

const at = (date: Date, over: Partial<Reading> = {}): Reading => ({
  key: `k-${date.getTime()}`,
  userId: 'u1',
  systolic: 120,
  diastolic: 78,
  pulse: 70,
  measuredAt: date,
  status: 'normal',
  createdAt: date,
  syncState: 'synced',
  ...over,
});

const daysAgo = (days: number) => {
  const date = new Date(NOW);
  date.setDate(NOW.getDate() - days);
  return date;
};

describe('cutoffFor', () => {
  it('returns nothing to compare against for "all"', () => {
    expect(cutoffFor('all', NOW)).toBeNull();
  });

  it('counts days back for the day ranges', () => {
    expect(cutoffFor('7days', NOW)).toEqual(daysAgo(7));
    expect(cutoffFor('30days', NOW)).toEqual(daysAgo(30));
  });

  // Calendar arithmetic, not 90 days — the user asked for three months.
  it('uses calendar months for "3 เดือน"', () => {
    expect(cutoffFor('3months', NOW)).toEqual(new Date(2026, 3, 29, 12, 0, 0));
  });

  it('uses calendar years for "1 ปี"', () => {
    expect(cutoffFor('1year', NOW)).toEqual(new Date(2025, 6, 29, 12, 0, 0));
  });
});

describe('filterByRange', () => {
  it('keeps everything for "all"', () => {
    const readings = [at(daysAgo(1)), at(daysAgo(900))];

    expect(filterByRange(readings, 'all', NOW)).toHaveLength(2);
  });

  it('drops readings older than the range', () => {
    const readings = [at(daysAgo(1)), at(daysAgo(8))];

    expect(filterByRange(readings, '7days', NOW)).toHaveLength(1);
  });

  // `>` instead of `>=` silently drops the oldest reading in every range, and
  // nobody notices until they count.
  it('includes a reading taken exactly on the boundary', () => {
    const readings = [at(daysAgo(7))];

    expect(filterByRange(readings, '7days', NOW)).toHaveLength(1);
  });

  it('returns an empty list rather than throwing when nothing is in range', () => {
    expect(filterByRange([at(daysAgo(400))], '7days', NOW)).toEqual([]);
  });
});

describe('chartSeries', () => {
  // A line chart reads left to right in time while every list in the app is
  // newest first. Getting this backwards draws the trend mirrored.
  it('returns oldest first, unlike the lists', () => {
    const series = chartSeries([at(daysAgo(1)), at(daysAgo(3)), at(daysAgo(2))]);

    expect(series.map((r) => r.measuredAt)).toEqual([daysAgo(3), daysAgo(2), daysAgo(1)]);
  });

  it('keeps only the most recent N', () => {
    const readings = Array.from({ length: 20 }, (_, i) => at(daysAgo(i)));

    const series = chartSeries(readings, 7);

    expect(series).toHaveLength(7);
    expect(series.at(-1)?.measuredAt).toEqual(daysAgo(0));
  });

  it('does not mutate its input', () => {
    const readings = [at(daysAgo(1)), at(daysAgo(3))];
    chartSeries(readings);

    expect(readings[0].measuredAt).toEqual(daysAgo(1));
  });

  it('survives an empty history', () => {
    expect(chartSeries([])).toEqual([]);
  });
});

describe('chartMaxValue', () => {
  // Otherwise a run of healthy readings is drawn as a dramatic mountain range.
  it('never drops below 140 for normal readings', () => {
    expect(chartMaxValue([at(daysAgo(1), { systolic: 118, diastolic: 76 })])).toBe(140);
  });

  it('leaves headroom above the highest value', () => {
    expect(chartMaxValue([at(daysAgo(1), { systolic: 185, diastolic: 120 })])).toBe(200);
  });

  it('has a sensible ceiling for an empty history', () => {
    expect(chartMaxValue([])).toBe(160);
  });
});
