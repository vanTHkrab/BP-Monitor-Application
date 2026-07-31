/**
 * Display formatting for Thai phone numbers typed into a TextInput.
 *
 *   10-digit (starts with 0) → 0XX-XXX-XXXX  (typical mobile / landline)
 *    9-digit                 → XX-XXX-XXXX   (dialled without the trunk "0")
 *
 * The GraphQL contract wants digits only — run `stripPhoneDigits` over the
 * formatted value before validating or sending it.
 */

/** Removes every non-digit character. */
export const stripPhoneDigits = (text: string): string => text.replace(/\D/g, '');

/**
 * Inserts hyphens at the groupings Thai numbers are actually written in, so
 * what the user sees matches how they would read the number aloud.
 *
 * A leading "66" with more than 9 digits — a full international number, with
 * or without the "+" — is rewritten to "0" + the rest, so a number pasted
 * from a contact card formats the same as one typed locally.
 */
export const formatThaiPhone = (raw: string): string => {
  let digits = stripPhoneDigits(raw);

  if (digits.startsWith('66') && digits.length > 9) {
    digits = `0${digits.slice(2)}`;
  }

  if (digits.startsWith('0')) {
    digits = digits.slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  digits = digits.slice(0, 9);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
};
