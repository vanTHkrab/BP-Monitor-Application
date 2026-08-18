/**
 * Display formatting for phone numbers typed into a TextInput.
 *
 *   10-digit (starts with 0) → 0XX-XXX-XXXX  (typical Thai mobile / landline)
 *    9-digit, no leading 0   → XX-XXX-XXXX   (Thai number dialled without the trunk "0")
 *   anything else            → digits, ungrouped
 *
 * The GraphQL contract wants digits only — run `stripPhoneDigits` over the
 * formatted value before validating or sending it. `stripPhoneDigits` is that
 * contract boundary and is untouched by everything below: it only strips
 * non-digit characters, so it cannot itself corrupt a number, and every fix
 * here is about what happens to the digits *after* that point.
 *
 * ## Why there is a third case
 *
 * The gateway's `PHONE_REGEX` accepts 9–15 digits (`server/app/api-gateway/
 * src/auth/types/auth.types.ts`), covering international numbers, not just
 * Thai ones. The first version of this function only had the two Thai cases,
 * and anything longer than 9 digits with no leading "0" fell through a bare
 * `digits.slice(0, 9)` — which did not reject the extra digits, it silently
 * *dropped* them and re-grouped what was left. `+14155551234` became
 * `14-155-512`: a different, shorter, still-plausible-looking number, with no
 * indication anything had been lost. That is worse than the truncation it
 * looks like, because a rejected input tells the user something is wrong and
 * a silently corrupted one does not — the person moves on believing the
 * number on screen is theirs.
 *
 * The fix is not to invent a grouping for whatever this number turns out to
 * be — we do not know the country, and a wrong guess at where the groups fall
 * makes a number unreadable to the person who owns it, which is the same
 * failure in a different shape. Once the input no longer matches either Thai
 * shape, it is rendered as plain digits: honest, ungrouped, and — this is the
 * point — *complete*. Capped at 15 to match `PHONE_REGEX`'s own ceiling, so
 * what is on screen and what `isValidPhone` will accept never disagree.
 *
 * ## Where the transition sits, and why it is not arbitrary
 *
 * Nine digits without a leading zero is not a UX threshold picked for this
 * function — it is the actual length of a Thai number dialled without the
 * trunk "0". A tenth digit arriving with no leading zero is not "a long Thai
 * number", it is proof the input was never a Thai number in the no-trunk
 * shape to begin with, so switching representations exactly there is
 * following the data, not guessing at it. This is also the standard approach
 * as-you-type phone formatters use elsewhere (e.g. libphonenumber's
 * `AsYouTypeFormatter`): keep formatting against the matched pattern for as
 * long as the input still fits it, fall back to ungrouped digits the moment
 * it stops fitting any known pattern.
 *
 * That still means the on-screen shape changes at that boundary — dashes that
 * were there a keystroke ago are gone. There is no grouped rendering to fall
 * back to instead without inventing one for a number whose country is
 * unknown, which is exactly what this function must not do. Editing back and
 * forth across that boundary (typing past 9, then backspacing under it) will
 * visibly flip formats each time; this is the same behaviour every
 * as-you-type formatter with a length-dependent pattern has, native phone
 * apps included. A smoother transition would mean changing *when* formatting
 * runs — e.g. holding the raw digits while a field has focus and only
 * inserting separators on blur — which changes the interaction model of
 * every phone field in the app and is a call for `ux-ui-designer`, not
 * something to improvise inside a formatting bug fix.
 *
 * ## What is deliberately unchanged
 *
 * The leading-"0" branch still hard-caps at 10 digits. A number that starts
 * with a literal "0" and is genuinely longer than 10 (a UK landline dialled
 * with its own trunk "0", for instance) will still lose digits past the
 * tenth here, same as before this fix. That is a known, narrower version of
 * the same corruption this function otherwise fixes, kept deliberately
 * in-scope-excluded: real Thai numbers are the overwhelming majority of what
 * this branch sees and it reads correctly for all of them today, and closing
 * the gap for the rare 0-leading foreign number is a second, separable
 * change if it turns out to matter.
 */

/** Removes every non-digit character. */
export const stripPhoneDigits = (text: string): string => text.replace(/\D/g, '');

/** The gateway's own ceiling (`PHONE_REGEX`) — never format or carry more digits than this. */
const MAX_PHONE_DIGITS = 15;
/** The length of a Thai number dialled without its trunk "0". Past this with no leading "0", the input is not Thai-shaped. */
const THAI_NO_TRUNK_LENGTH = 9;

/**
 * Inserts hyphens at the groupings Thai numbers are actually written in, so
 * what the user sees matches how they would read the number aloud — for the
 * two shapes this function actually recognises. Anything else renders as
 * plain digits; see the file docblock for why that is the honest choice
 * rather than a gap to fill in later.
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

  // The hard ceiling applies uniformly, before either shape check, so a
  // pasted string longer than the gateway will ever accept cannot reach
  // either branch below with extra digits still attached.
  digits = digits.slice(0, MAX_PHONE_DIGITS);

  if (digits.startsWith('0')) {
    digits = digits.slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length <= THAI_NO_TRUNK_LENGTH) {
    if (digits.length === 0) return '';
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }

  // Not Thai-shaped: no leading "0", and longer than a no-trunk Thai number
  // can be. Render the digits as-is rather than invent a grouping for a
  // country this function does not know.
  return digits;
};
