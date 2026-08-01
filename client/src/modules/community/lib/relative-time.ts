/**
 * "3 ชั่วโมงที่แล้ว" — the timestamp under every post and comment.
 *
 * Ported from client-old's `formatRelativeTimeTH`, minus the Firestore
 * `Timestamp` branch it carried. That branch was dead: the app has talked to
 * a GraphQL gateway since before this tree existed, and `toDateSafe` accepting
 * `{ seconds, nanoseconds }` was left over from a Firebase backend. Dates
 * arrive here already parsed by the mappers.
 *
 * `now` is injectable so the ladder is assertable without freezing the clock.
 */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Thresholds are deliberately coarse at the top. "13 เดือนที่แล้ว" is
 * arithmetic, not information — past a year, the year is the answer.
 */
export function formatRelativeTimeTH(value: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1000));

  if (seconds < MINUTE) return 'เมื่อสักครู่';
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)} นาทีที่แล้ว`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)} ชั่วโมงที่แล้ว`;
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)} วันที่แล้ว`;

  const days = Math.floor(seconds / DAY);
  if (days < 30) return `${Math.floor(days / 7)} สัปดาห์ที่แล้ว`;

  // Hands over to years at twelve 30-day months, not at 365 days. Comparing
  // against a real year leaves a gap where `days / 30` reaches 12 and the
  // string reads "12 เดือนที่แล้ว" — a year, spelled the long way.
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} เดือนที่แล้ว`;

  // `days / 365` is 0 for the 360-364 day window this now covers.
  return `${Math.max(1, Math.floor(days / 365))} ปีที่แล้ว`;
}
