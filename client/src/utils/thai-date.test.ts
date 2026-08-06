/**
 * These feed exported documents, so the era and the zero-padding are the
 * whole point — a report dated 2026 instead of 2569, or a filename that sorts
 * `2026710` before `20260610`, is wrong in a way nobody thinks to check.
 */
import { formatFileDate, formatThaiDate, formatThaiDateTime } from './thai-date';

describe('formatThaiDate', () => {
  it('renders the Buddhist year and the abbreviated Thai month', () => {
    expect(formatThaiDate(new Date(2026, 6, 10))).toBe('10 ก.ค. 2569');
  });

  it.each([
    [0, 'ม.ค.'],
    [11, 'ธ.ค.'],
  ])('covers month index %i', (month, label) => {
    expect(formatThaiDate(new Date(2026, month, 1))).toContain(label);
  });

  it('does not pad the day — "1 ม.ค." is how the app writes it elsewhere', () => {
    expect(formatThaiDate(new Date(2026, 0, 1))).toBe('1 ม.ค. 2569');
  });

  it('returns a dash for an unusable date rather than "Invalid Date"', () => {
    expect(formatThaiDate(new Date(Number.NaN))).toBe('-');
  });
});

describe('formatThaiDateTime', () => {
  it('appends zero-padded 24-hour time', () => {
    expect(formatThaiDateTime(new Date(2026, 6, 10, 21, 52))).toBe(
      '10 ก.ค. 2569 21:52',
    );
  });

  it('pads a single-digit hour and minute', () => {
    expect(formatThaiDateTime(new Date(2026, 6, 10, 9, 5))).toBe(
      '10 ก.ค. 2569 09:05',
    );
  });

  it('keeps midnight as 00:00 rather than rolling to 12', () => {
    expect(formatThaiDateTime(new Date(2026, 6, 10, 0, 0))).toBe(
      '10 ก.ค. 2569 00:00',
    );
  });
});

describe('formatFileDate', () => {
  it('is Gregorian and zero-padded, so exports sort chronologically', () => {
    expect(formatFileDate(new Date(2026, 6, 10))).toBe('20260710');
    expect(formatFileDate(new Date(2026, 0, 5))).toBe('20260105');
  });

  it('sorts lexicographically in date order', () => {
    const dates = [new Date(2026, 6, 10), new Date(2026, 5, 1), new Date(2025, 11, 31)];
    const sorted = dates.map(formatFileDate).sort();

    expect(sorted).toEqual(['20251231', '20260601', '20260710']);
  });

  it('does not silently produce a Buddhist year', () => {
    expect(formatFileDate(new Date(2026, 6, 10))).not.toContain('2569');
  });

  it('is a marker rather than a crash for an unusable date', () => {
    expect(formatFileDate(new Date(Number.NaN))).toBe('unknown');
  });
});
