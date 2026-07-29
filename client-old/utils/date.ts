/**
 * True when `value` is a real calendar date in strict `YYYY-MM-DD` form.
 *
 * The birthday field talks to the gateway's `DateTime` GraphQL scalar
 * (GraphQLISODateTime), which parses incoming values with `new Date(value)`.
 * That parse has two traps a bare `^\d{4}-\d{2}-\d{2}$` regex misses:
 *
 *   - Out-of-range components like `2000-13-45` make `new Date` return an
 *     Invalid Date, so the scalar throws a generic GraphQL parse error before
 *     the request reaches the resolver — the user sees a cryptic failure
 *     instead of an inline "invalid date" message.
 *   - Overflowing-but-parseable components like `2000-02-30` or `2001-02-29`
 *     (non-leap year) are silently rolled over to the next month (Mar 1), so
 *     the server would store a *different* date than the user typed.
 *
 * Validating the UTC round-trip here rejects both classes up front, keeping the
 * client's accept-set identical to what the gateway will actually store. UTC
 * getters are mandatory: `new Date('2000-01-15')` is parsed as UTC midnight, so
 * local getters would shift the day in negative-offset timezones.
 */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const [year, month, day] = value.split('-').map(Number);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

/**
 * Format a `Date` as `YYYY-MM-DD` using its *local* calendar components.
 *
 * The native date picker yields a `Date` at local midnight for the day the
 * user tapped, so local getters reproduce that exact day. The resulting
 * string round-trips cleanly through `isValidIsoDate` (which re-parses as UTC)
 * because a zero-padded in-range `YYYY-MM-DD` is timezone-stable.
 */
export function formatIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a strict `YYYY-MM-DD` string into a local-midnight `Date`, or return
 * `null` when the string is empty / malformed. Used to seed the date picker
 * from the current field value without the UTC day-shift that
 * `new Date('YYYY-MM-DD')` introduces in negative-offset timezones.
 */
export function parseIsoDate(value: string): Date | null {
  if (!isValidIsoDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
