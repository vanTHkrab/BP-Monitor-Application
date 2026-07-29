// Display formatter for Thai phone numbers entered via TextInput.
//
//   10-digit (starts with 0)  → 0XX-XXX-XXXX  (typical mobile / landline)
//    9-digit                   → XX-XXX-XXXX   (locally-dialled without the
//                                                trunk "0")
//
// The store / GraphQL contract still expects digits only — call
// `stripPhoneDigits` on the formatted value before validating or sending.

/** Remove every non-digit character. */
export const stripPhoneDigits = (text: string): string =>
  text.replace(/\D/g, "");

/**
 * Insert hyphens at the visually-natural Thai groupings so the value the
 * user sees in the input matches how phone numbers are written / read in
 * Thai. Truncates over-long input (e.g. accidental double-typed digits).
 *
 * Side effect of paste-friendliness: a leading "66" with more than 9
 * digits (i.e. a full international Thai number, with or without "+") is
 * rewritten to "0" + the rest so contacts copied from elsewhere format
 * the same as locally-typed numbers.
 */
export const formatThaiPhone = (raw: string): string => {
  let digits = stripPhoneDigits(raw);

  if (digits.startsWith("66") && digits.length > 9) {
    digits = "0" + digits.slice(2);
  }

  if (digits.startsWith("0")) {
    digits = digits.slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  digits = digits.slice(0, 9);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
};
