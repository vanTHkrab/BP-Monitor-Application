import { formatThaiPhone, stripPhoneDigits } from './phone-format';

describe('stripPhoneDigits', () => {
  it('keeps only digits', () => {
    expect(stripPhoneDigits('081-234-5678')).toBe('0812345678');
    expect(stripPhoneDigits('+66 81 234 5678')).toBe('66812345678');
    expect(stripPhoneDigits('')).toBe('');
  });
});

describe('formatThaiPhone', () => {
  it('groups a 10-digit number as 0XX-XXX-XXXX', () => {
    expect(formatThaiPhone('0812345678')).toBe('081-234-5678');
  });

  it('groups progressively as the user types', () => {
    // The hyphens must not jump around mid-entry, or the caret does too.
    expect(formatThaiPhone('081')).toBe('081');
    expect(formatThaiPhone('0812')).toBe('081-2');
    expect(formatThaiPhone('081234')).toBe('081-234');
    expect(formatThaiPhone('0812345')).toBe('081-234-5');
  });

  it('groups a 9-digit number without the trunk zero as XX-XXX-XXXX', () => {
    expect(formatThaiPhone('812345678')).toBe('81-234-5678');
  });

  it('groups progressively as the user types without a leading zero', () => {
    // Mirrors the leading-zero progressive test above, for the other shape.
    expect(formatThaiPhone('8')).toBe('8');
    expect(formatThaiPhone('81')).toBe('81');
    expect(formatThaiPhone('812')).toBe('81-2');
    expect(formatThaiPhone('81234')).toBe('81-234');
    expect(formatThaiPhone('812345')).toBe('81-234-5');
  });

  it('rewrites a pasted international number to the local form', () => {
    // Copying from a contact card is the common path here; without this the
    // number formats differently from one typed by hand.
    expect(formatThaiPhone('+66812345678')).toBe('081-234-5678');
    expect(formatThaiPhone('66812345678')).toBe('081-234-5678');
  });

  it('leaves a short number starting with 66 alone', () => {
    // 9 digits or fewer starting with "66" is a local number, not a country
    // code — rewriting it would corrupt a valid entry.
    expect(formatThaiPhone('661234567')).toBe('66-123-4567');
  });

  /*
   * The leading-"0" shape is deliberately unchanged: it still hard-caps at 10
   * digits, so an over-long 0-leading number loses digits past the tenth the
   * same as before this file's corruption fix. See the file docblock for why
   * that gap is being kept rather than closed here.
   */
  it('still caps a 0-leading number at 10 digits', () => {
    expect(formatThaiPhone('08123456789999')).toBe('081-234-5678');
  });

  /*
   * This was the actual defect, not the truncation its old name claimed:
   * `formatThaiPhone('81234567899')` (11 digits, no leading 0) used to return
   * `'81-234-5678'` — a *different*, shorter, still valid-looking number, with
   * the trailing "99" silently dropped rather than rejected. A test asserting
   * that as correct is what let it ship. The fixed behaviour is to render
   * every digit, ungrouped, once the input no longer fits either Thai shape —
   * see the docblock for why grouping is not invented for it instead.
   */
  it('preserves every digit of a non-Thai-shaped number rather than corrupting it', () => {
    expect(formatThaiPhone('81234567899')).toBe('81234567899');
  });

  // The reported case exactly: a pasted US number must survive intact or be
  // rejected by `isValidPhone` downstream — never silently become a different,
  // shorter number that also happens to pass validation.
  it('keeps a full international number intact rather than rewriting it into a different one', () => {
    expect(formatThaiPhone('+14155551234')).toBe('14155551234');
    expect(formatThaiPhone('+14155551234')).not.toBe('14-155-512');
  });

  // The gateway's own ceiling (`PHONE_REGEX`, 9-15 digits) — the display must
  // never carry more than `isValidPhone` will accept, or the field shows a
  // number the user believes is valid and the server will refuse.
  it('caps a non-Thai-shaped number at 15 digits, matching the gateway ceiling', () => {
    expect(formatThaiPhone('1234567890123456789')).toBe('123456789012345');
    expect(formatThaiPhone('1234567890123456789').length).toBe(15);
  });

  /*
   * The transition boundary is exactly 9 digits without a leading zero — the
   * true length of a Thai number dialled without the trunk "0" — not a
   * rounder or more convenient number. One digit short, it is still grouped
   * the way it always was; one digit past, grouping stops because the input
   * has proven it is not that shape.
   */
  it('groups right up to 9 digits and switches to ungrouped on the 10th', () => {
    expect(formatThaiPhone('812345678')).toBe('81-234-5678'); // 9: still Thai-shaped
    expect(formatThaiPhone('8123456789')).toBe('8123456789'); // 10: no longer is
  });

  it('is idempotent over its own output', () => {
    // The input re-formats on every keystroke, so f(f(x)) must equal f(x).
    const once = formatThaiPhone('0812345678');
    expect(formatThaiPhone(once)).toBe(once);
  });

  // The same property has to hold on the other side of the transition: a
  // controlled `TextInput` feeds this function's own last output back in on
  // every keystroke, so a formatter that reformatted its ungrouped output
  // differently on a second pass would visibly misbehave while typing.
  it('is idempotent over its own ungrouped output too', () => {
    const once = formatThaiPhone('14155551234');
    expect(formatThaiPhone(once)).toBe(once);
  });

  it('returns empty for input with no digits', () => {
    expect(formatThaiPhone('')).toBe('');
    expect(formatThaiPhone('abc')).toBe('');
  });
});
