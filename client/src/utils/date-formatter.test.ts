import { formatIsoDate, isValidIsoDate, parseIsoDate } from './date-formatter';

describe('isValidIsoDate', () => {
  it('accepts a real date', () => {
    expect(isValidIsoDate('2000-01-15')).toBe(true);
    expect(isValidIsoDate('2000-02-29')).toBe(true); // 2000 is a leap year
  });

  it('rejects a date that would silently roll into the next month', () => {
    // `new Date('2001-02-29')` parses fine and becomes March 1 — the server
    // would store a different day than the user picked.
    expect(isValidIsoDate('2001-02-29')).toBe(false);
    expect(isValidIsoDate('2000-02-30')).toBe(false);
    expect(isValidIsoDate('2000-04-31')).toBe(false);
  });

  it('rejects out-of-range components', () => {
    // These reach the GraphQL DateTime scalar as an Invalid Date and surface
    // as a generic parse error rather than an inline field message.
    expect(isValidIsoDate('2000-13-01')).toBe(false);
    expect(isValidIsoDate('2000-00-10')).toBe(false);
    expect(isValidIsoDate('2000-01-32')).toBe(false);
  });

  it('rejects anything not in strict zero-padded form', () => {
    expect(isValidIsoDate('2000-1-15')).toBe(false);
    expect(isValidIsoDate('15/01/2000')).toBe(false);
    expect(isValidIsoDate('2000-01-15T00:00:00Z')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });
});

describe('formatIsoDate', () => {
  it('formats from local components, matching what the picker returned', () => {
    // The picker hands back local midnight; using UTC getters here would
    // shift the day by one in negative-offset timezones.
    expect(formatIsoDate(new Date(2000, 0, 15))).toBe('2000-01-15');
  });

  it('zero-pads single-digit months and days', () => {
    expect(formatIsoDate(new Date(2000, 8, 5))).toBe('2000-09-05');
  });

  it('round-trips through isValidIsoDate', () => {
    const formatted = formatIsoDate(new Date(1960, 2, 2));
    expect(isValidIsoDate(formatted)).toBe(true);
  });
});

describe('parseIsoDate', () => {
  it('returns local midnight for the same calendar day', () => {
    const parsed = parseIsoDate('2000-01-15');
    expect(parsed?.getFullYear()).toBe(2000);
    expect(parsed?.getMonth()).toBe(0);
    expect(parsed?.getDate()).toBe(15);
  });

  it('returns null rather than an Invalid Date for bad input', () => {
    expect(parseIsoDate('2001-02-29')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate('nonsense')).toBeNull();
  });

  it('round-trips with formatIsoDate', () => {
    const original = '1985-07-09';
    expect(formatIsoDate(parseIsoDate(original)!)).toBe(original);
  });
});
