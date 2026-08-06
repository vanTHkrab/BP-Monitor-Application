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

  it('truncates over-long input rather than formatting garbage', () => {
    expect(formatThaiPhone('08123456789999')).toBe('081-234-5678');
    expect(formatThaiPhone('81234567899')).toBe('81-234-5678');
  });

  it('is idempotent over its own output', () => {
    // The input re-formats on every keystroke, so f(f(x)) must equal f(x).
    const once = formatThaiPhone('0812345678');
    expect(formatThaiPhone(once)).toBe(once);
  });

  it('returns empty for input with no digits', () => {
    expect(formatThaiPhone('')).toBe('');
    expect(formatThaiPhone('abc')).toBe('');
  });
});
