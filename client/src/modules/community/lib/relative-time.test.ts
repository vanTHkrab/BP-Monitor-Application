import { formatRelativeTimeTH } from './relative-time';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('formatRelativeTimeTH', () => {
  it.each([
    [0, 'เมื่อสักครู่'],
    [59, 'เมื่อสักครู่'],
    [60, '1 นาทีที่แล้ว'],
    [59 * 60, '59 นาทีที่แล้ว'],
    [60 * 60, '1 ชั่วโมงที่แล้ว'],
    [23 * 3600, '23 ชั่วโมงที่แล้ว'],
    [24 * 3600, '1 วันที่แล้ว'],
    [6 * 24 * 3600, '6 วันที่แล้ว'],
    [7 * 24 * 3600, '1 สัปดาห์ที่แล้ว'],
    [29 * 24 * 3600, '4 สัปดาห์ที่แล้ว'],
    [30 * 24 * 3600, '1 เดือนที่แล้ว'],
    [359 * 24 * 3600, '11 เดือนที่แล้ว'],
    // The gap this covers: `days / 30` hits 12 here while `days / 365` is
    // still 0, so a naive ladder renders "12 เดือนที่แล้ว" — a year, spelled
    // the long way — or "0 ปีที่แล้ว".
    [360 * 24 * 3600, '1 ปีที่แล้ว'],
    [364 * 24 * 3600, '1 ปีที่แล้ว'],
    [365 * 24 * 3600, '1 ปีที่แล้ว'],
    [800 * 24 * 3600, '2 ปีที่แล้ว'],
  ])('renders %i seconds ago as "%s"', (seconds, expected) => {
    expect(formatRelativeTimeTH(ago(seconds), NOW)).toBe(expected);
  });

  // Clock skew between phone and server is normal and must not produce
  // "-3 นาทีที่แล้ว" on a post that was just created.
  it('clamps a future timestamp to "just now"', () => {
    const future = new Date(NOW.getTime() + 5 * 60 * 1000);

    expect(formatRelativeTimeTH(future, NOW)).toBe('เมื่อสักครู่');
  });
});
