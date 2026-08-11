import {
  type EmailOtpType,
  otpEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from './mail.templates';

describe('mail templates', () => {
  describe('otpEmail', () => {
    it('gives each purpose its own subject', () => {
      const subjects = (
        [
          'sign-in',
          'email-verification',
          'forget-password',
          'change-email',
        ] as EmailOtpType[]
      ).map((type) => otpEmail(type, '123456').subject);

      // The bug this guards: one shared subject meant a password-reset code
      // arrived titled "รหัสยืนยัน BP Monitor".
      expect(new Set(subjects).size).toBe(4);
    });

    it('names the password reset in its own subject', () => {
      expect(otpEmail('forget-password', '123456').subject).toContain(
        'ตั้งรหัสผ่านใหม่',
      );
    });

    it.each([
      'sign-in',
      'email-verification',
      'forget-password',
      'change-email',
    ] as const)('puts the code in both parts for %s', (type) => {
      const { text, html } = otpEmail(type, '123456');

      expect(text).toContain('123456');
      // A text-only body whose whole content is a number is a spam trigger,
      // so the HTML part is not optional in practice.
      expect(html).toContain('123456');
    });

    it('falls back to verification copy for an unknown type', () => {
      // A Better Auth upgrade that adds a fifth purpose should send slightly
      // generic mail, not throw inside the request.
      const unknown = otpEmail('two-factor' as EmailOtpType, '123456');

      expect(unknown.subject).toBe(
        otpEmail('email-verification', '123456').subject,
      );
    });
  });

  describe('link emails', () => {
    const url = 'https://api.example.com/api/auth/reset?token=abc&x=1';

    it('includes the reset URL verbatim in the text part', () => {
      expect(resetPasswordEmail(url).text).toContain(url);
    });

    it('escapes the URL in the HTML part', () => {
      const { html } = resetPasswordEmail(url);

      expect(html).toContain('&amp;x=1');
      expect(html).not.toContain('&x=1');
    });

    it('gives verification and reset different subjects', () => {
      expect(verifyEmailEmail(url).subject).not.toBe(
        resetPasswordEmail(url).subject,
      );
    });
  });
});
