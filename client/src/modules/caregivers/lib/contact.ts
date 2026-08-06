/**
 * The "phone or email" rule for the invite field (A-005).
 *
 * `addCaregiverPatient` takes one polymorphic `patientContact` argument and
 * the gateway decides what it is: a string containing "@" is looked up as an
 * email, anything else as a phone number. A Thai phone number can never
 * contain an "@", so the split is unambiguous and the caregiver is never
 * asked to classify their own input with a mode toggle.
 *
 * The client has to know the same rule for one reason only — not to validate,
 * but to decide whether to *touch* the text. The phone path formats as you
 * type and strips to digits before sending, and both of those destroy an
 * email address.
 *
 * Validation here is deliberately looser than the gateway's. A client check
 * stricter than the server locks a legitimate account out of being invited
 * with no way to appeal, so this only catches what the user can already see
 * is wrong. There is no email regex.
 */
import { formatThaiPhone, stripPhoneDigits } from '@/utils/phone-format';

/** Thai numbers are 9 digits without the trunk "0", 10 with it. */
const MIN_PHONE_DIGITS = 9;

/** The one rule, mirrored from `caregiver.service.ts`. */
export const isEmailContact = (text: string): boolean => text.includes('@');

/**
 * What actually goes on the wire.
 *
 * Phone → digits only, because the gateway does an exact `User.phone` match
 * and a display-formatted "081-234-5678" finds nobody, surfacing as
 * "ไม่พบผู้ใช้จากเบอร์โทรศัพท์นี้" — a lie about why it failed.
 * Email → trimmed and lowercased, matching how Better Auth stores it. Nothing
 * else is stripped: every character in an address is significant.
 */
export const prepareContact = (text: string): string =>
  isEmailContact(text) ? text.trim().toLowerCase() : stripPhoneDigits(text);

/**
 * What the field should hold after a keystroke, given what it held before.
 *
 * The `prev` argument is not decoration. On the phone branch the buffer holds
 * hyphens *we* inserted, so typing "@" at the end of "081-234-5678" would
 * otherwise leave "081-234-5678@" — a half-formatted string that is neither a
 * phone number nor an address. Those hyphens are removed on the flip, but
 * only from the part of the text that survived from `prev`: a pasted
 * "some-one@example.com" shares no prefix with the old value, so its own
 * hyphens are left alone.
 */
export function nextContactValue(prev: string, next: string): string {
  if (!isEmailContact(next)) return formatThaiPhone(next);
  if (isEmailContact(prev)) return next;

  // Flipping phone → email: undo our formatting over the retained prefix.
  let shared = 0;
  while (shared < prev.length && shared < next.length && prev[shared] === next[shared]) {
    shared += 1;
  }
  return next.slice(0, shared).replace(/-/g, '') + next.slice(shared);
}

/**
 * The inline field error, or `undefined` when there is nothing obviously
 * wrong. Both messages name the kind the user is already typing — telling
 * someone mid-address that their phone number is incomplete reads as a bug.
 */
export function contactError(text: string): string | undefined {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return 'กรุณากรอกเบอร์โทรศัพท์หรืออีเมลของผู้ป่วย';
  }

  if (isEmailContact(trimmed)) {
    const [local, ...rest] = trimmed.split('@');
    const domain = rest.join('@');
    // An "@" with nothing on one side of it is the only thing checked. Domain
    // shape, TLDs, and plus-addressing are the server's business.
    return local.length > 0 && domain.length > 0
      ? undefined
      : 'กรุณากรอกอีเมลของผู้ป่วยให้ครบ';
  }

  return stripPhoneDigits(trimmed).length < MIN_PHONE_DIGITS
    ? 'กรุณากรอกเบอร์โทรศัพท์ของผู้ป่วยให้ครบ'
    : undefined;
}
