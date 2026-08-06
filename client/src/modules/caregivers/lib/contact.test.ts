/**
 * The "@" split (A-005) — the only rule the client shares with the gateway.
 *
 * What is asserted here is the destructive half: the phone path formats and
 * strips, and running either of those over an email address is how a
 * legitimate invite turns into "ไม่พบผู้ใช้จากเบอร์โทรศัพท์นี้".
 */
import { contactError, isEmailContact, nextContactValue, prepareContact } from './contact';

describe('prepareContact', () => {
  it('strips a formatted phone back to digits', () => {
    expect(prepareContact('081-234-5678')).toBe('0812345678');
  });

  it('leaves an email intact apart from trim and lowercase', () => {
    expect(prepareContact('  Some.One+bp@Example.COM ')).toBe('some.one+bp@example.com');
  });

  it('keeps the digits in an email rather than reducing it to them', () => {
    expect(prepareContact('user081@example.com')).toBe('user081@example.com');
  });
});

describe('nextContactValue', () => {
  it('formats as you type while there is no "@"', () => {
    expect(nextContactValue('081', '0812')).toBe('081-2');
  });

  it('drops the formatting it inserted when the user types "@"', () => {
    // Without this the buffer keeps "081-234-5678@" — neither a phone number
    // nor an address, and unfixable except by clearing the field.
    expect(nextContactValue('081-234-5678', '081-234-5678@')).toBe('0812345678@');
  });

  it('leaves a pasted address alone, hyphens included', () => {
    expect(nextContactValue('', 'some-one@example.com')).toBe('some-one@example.com');
  });

  it('stops touching the text once it is already an address', () => {
    expect(nextContactValue('a@b.c', 'a@b.co')).toBe('a@b.co');
  });

  it('re-formats when the "@" is deleted again', () => {
    expect(nextContactValue('0812345678@', '0812345678')).toBe('081-234-5678');
  });
});

describe('contactError', () => {
  it('accepts a complete phone number', () => {
    expect(contactError('081-234-5678')).toBeUndefined();
  });

  it('rejects a short phone number, naming the phone', () => {
    expect(contactError('081-23')).toBe('กรุณากรอกเบอร์โทรศัพท์ของผู้ป่วยให้ครบ');
  });

  it('rejects an "@" with nothing around it, naming the email', () => {
    expect(contactError('@')).toBe('กรุณากรอกอีเมลของผู้ป่วยให้ครบ');
    expect(contactError('someone@')).toBe('กรุณากรอกอีเมลของผู้ป่วยให้ครบ');
    expect(contactError('@example.com')).toBe('กรุณากรอกอีเมลของผู้ป่วยให้ครบ');
  });

  it('asks for either kind when the field is empty', () => {
    expect(contactError('   ')).toBe('กรุณากรอกเบอร์โทรศัพท์หรืออีเมลของผู้ป่วย');
  });

  /*
   * Deliberately looser than the server. A client check stricter than the
   * gateway's locks a real account out of being invited with no way to
   * appeal, so anything with text on both sides of the "@" is passed through
   * and the server gets the last word.
   */
  it('passes through addresses an RFC regex would argue about', () => {
    expect(contactError('a@b')).toBeUndefined();
    expect(contactError("o'brien+bp@sub.domain.co.th")).toBeUndefined();
  });
});

describe('isEmailContact', () => {
  it('is the "@" test and nothing more', () => {
    expect(isEmailContact('0812345678')).toBe(false);
    expect(isEmailContact('a@b')).toBe(true);
  });
});
