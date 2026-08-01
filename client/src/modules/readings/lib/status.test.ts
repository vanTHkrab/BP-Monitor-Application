import { BP_THRESHOLDS, classifyReading, parseStatus, statusLabel } from './status';

describe('classifyReading', () => {
  it.each([
    [118, 76, 'normal'],
    [119, 79, 'normal'],
    [130, 80, 'elevated'],
    [120, 85, 'elevated'],
    [140, 80, 'high'],
    [120, 90, 'high'],
    [180, 100, 'critical'],
    [150, 120, 'critical'],
    [85, 70, 'low'],
    [110, 55, 'low'],
  ])('classifies %i/%i as %s', (systolic, diastolic, expected) => {
    expect(classifyReading(systolic, diastolic)).toBe(expected);
  });

  // Either number crossing the bound is enough. Taking the milder of the two
  // would tell someone with an isolated diastolic of 95 that they are fine.
  it('escalates on whichever number is worse', () => {
    expect(classifyReading(110, 95)).toBe('high');
    expect(classifyReading(145, 70)).toBe('high');
  });

  // Low is evaluated before the high bands. A pair like this usually means
  // the cuff slipped, and filing it as hypertension picks the scarier half.
  it('prefers low over high for a contradictory pair', () => {
    expect(classifyReading(85, 95)).toBe('low');
  });

  it.each([
    ['elevated', BP_THRESHOLDS.elevated],
    ['high', BP_THRESHOLDS.high],
    ['critical', BP_THRESHOLDS.critical],
  ])('treats the %s systolic bound as inclusive', (expected, bound) => {
    expect(classifyReading(bound.systolic, 70)).toBe(expected);
    expect(classifyReading(bound.systolic - 1, 70)).not.toBe(expected);
  });

  it('treats the low bound as exclusive', () => {
    expect(classifyReading(BP_THRESHOLDS.low.systolic, 70)).not.toBe('low');
    expect(classifyReading(BP_THRESHOLDS.low.systolic - 1, 70)).toBe('low');
  });
});

describe('parseStatus', () => {
  it('passes a known status through', () => {
    expect(parseStatus('critical')).toBe('critical');
  });

  // A row written by a future build must render, not crash the list.
  it.each([['unknown'], [''], [null], [undefined]])('falls back to normal for %p', (value) => {
    expect(parseStatus(value)).toBe('normal');
  });
});

describe('statusLabel', () => {
  it('has Thai copy for every status', () => {
    const statuses = ['low', 'normal', 'elevated', 'high', 'critical'] as const;

    statuses.forEach((status) => {
      expect(statusLabel(status)).toMatch(/[฀-๿]/);
    });
  });
});
