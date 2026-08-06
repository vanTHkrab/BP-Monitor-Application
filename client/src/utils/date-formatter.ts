/**
 * `YYYY-MM-DD` helpers for date fields that talk to the gateway.
 *
 * Ported from client-old/utils/date.ts — the reasoning below is the reason
 * these are not a one-line regex.
 */

/**
 * True when `value` is a real calendar date in strict `YYYY-MM-DD` form.
 *
 * The birthday field feeds the gateway's `DateTime` scalar
 * (GraphQLISODateTime), which parses with `new Date(value)`. That parse has
 * two traps a bare `^\d{4}-\d{2}-\d{2}$` regex misses:
 *
 *   - Out-of-range components like `2000-13-45` produce an Invalid Date, so
 *     the scalar throws a generic GraphQL parse error before the request
 *     reaches the resolver — the user sees a cryptic failure instead of an
 *     inline message.
 *   - Overflowing-but-parseable components like `2000-02-30` or `2001-02-29`
 *     (not a leap year) roll silently into the next month, so the server
 *     stores a *different* date than the user picked.
 *
 * Validating the UTC round-trip rejects both up front, keeping this accept-set
 * identical to what the gateway will actually store. The UTC getters are
 * mandatory: `new Date('2000-01-15')` parses as UTC midnight, so local
 * getters would shift the day in negative-offset timezones.
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
 * Formats a `Date` as `YYYY-MM-DD` from its *local* components.
 *
 * The native picker yields local midnight for the day the user tapped, so
 * local getters reproduce that exact day. The result round-trips through
 * `isValidIsoDate` (which re-parses as UTC) because a zero-padded, in-range
 * `YYYY-MM-DD` is timezone-stable.
 */
export function formatIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a strict `YYYY-MM-DD` into a local-midnight `Date`, or `null` when
 * the string is empty or malformed. Seeds the picker from the field's current
 * value without the UTC day-shift `new Date('YYYY-MM-DD')` introduces.
 */
export function parseIsoDate(value: string): Date | null {
  if (!isValidIsoDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
