const createTransport = jest.fn();

// Hoisted above the import by Jest, so the module under test never loads the
// real nodemailer — no socket is opened even if a test misconfigures the host.
jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]): unknown =>
    createTransport(...args) as unknown,
}));

import { MailService } from './mail.service';

/**
 * These tests exist because of what they can reach: `MailService` is the send
 * path lifted out of `auth/better-auth.ts`, which the CJS Jest setup cannot
 * parse at all. Everything asserted below was unreachable while it lived
 * there.
 */
describe('MailService', () => {
  const ENV = process.env;
  let sendMail: jest.Mock;
  let close: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...ENV };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.MAIL_FROM;

    sendMail = jest.fn().mockResolvedValue(undefined);
    close = jest.fn();
    createTransport.mockReturnValue({ sendMail, close });
  });

  afterAll(() => {
    process.env = ENV;
  });

  const message = {
    to: 'patient@example.com',
    subject: 'รหัสยืนยัน',
    text: 'code 123456',
    html: '<p>123456</p>',
  };

  describe('with no SMTP_HOST', () => {
    it('throws in production rather than dropping a credential silently', async () => {
      process.env.NODE_ENV = 'production';

      await expect(new MailService().send(message)).rejects.toThrow(
        /SMTP_HOST is not set/,
      );
      expect(createTransport).not.toHaveBeenCalled();
    });

    it('logs and resolves in development so a fresh checkout works', async () => {
      process.env.NODE_ENV = 'development';
      const service = new MailService();
      const debug = jest
        .spyOn(service['logger'], 'debug')
        .mockImplementation(() => undefined);

      await expect(service.send(message)).resolves.toBeUndefined();

      // The one-time code has to be in the development log — that is the
      // whole point of the branch — which is also why it must not run in
      // production.
      expect(debug).toHaveBeenCalledWith(
        expect.stringContaining('code 123456'),
      );
      expect(createTransport).not.toHaveBeenCalled();
    });

    it('treats a whitespace-only host as unset', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SMTP_HOST = '   ';

      await expect(new MailService().send(message)).rejects.toThrow(
        /SMTP_HOST is not set/,
      );
    });
  });

  describe('transport configuration', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.SMTP_HOST = 'smtp.resend.com';
    });

    it('defaults to port 587 with STARTTLS, not implicit TLS', async () => {
      await new MailService().send(message);

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.resend.com',
          port: 587,
          secure: false,
          pool: true,
        }),
      );
    });

    it('uses implicit TLS on 465', async () => {
      process.env.SMTP_PORT = '465';

      await new MailService().send(message);

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, secure: true }),
      );
    });

    it('omits auth entirely when SMTP_USER is unset', async () => {
      // A local Mailpit accepts no AUTH at all and rejects an incomplete
      // exchange, so empty strings here would break the dev stack.
      await new MailService().send(message);

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined }),
      );
    });

    it('sends credentials when SMTP_USER is set', async () => {
      process.env.SMTP_USER = 'resend';
      process.env.SMTP_PASSWORD = 're_test_key';

      await new MailService().send(message);

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { user: 'resend', pass: 're_test_key' },
        }),
      );
    });

    it('sets short timeouts, because a user is waiting on the request', async () => {
      await new MailService().send(message);

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionTimeout: 5_000,
          greetingTimeout: 5_000,
          socketTimeout: 10_000,
        }),
      );
    });

    it('rejects a non-numeric SMTP_PORT instead of passing NaN to nodemailer', async () => {
      process.env.SMTP_PORT = 'smtp';

      await expect(new MailService().send(message)).rejects.toThrow(
        /SMTP_PORT is not a valid port number/,
      );
      expect(createTransport).not.toHaveBeenCalled();
    });

    it('builds the transport once and reuses it across sends', async () => {
      const service = new MailService();

      await service.send(message);
      await service.send(message);

      expect(createTransport).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(2);
    });
  });

  describe('sending', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.SMTP_HOST = 'smtp.resend.com';
    });

    it('forwards both parts and the configured From', async () => {
      process.env.MAIL_FROM = 'BP Monitor <no-reply@example.com>';

      await new MailService().send(message);

      expect(sendMail).toHaveBeenCalledWith({
        from: 'BP Monitor <no-reply@example.com>',
        to: 'patient@example.com',
        subject: 'รหัสยืนยัน',
        text: 'code 123456',
        html: '<p>123456</p>',
      });
    });

    it('falls back to a placeholder From when MAIL_FROM is unset', async () => {
      await new MailService().send(message);

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'BP Monitor <no-reply@localhost>' }),
      );
    });

    it('propagates a delivery failure rather than swallowing it', async () => {
      // Better Auth awaits this inside the request, so the user finds out.
      sendMail.mockRejectedValue(new Error('550 domain not verified'));

      await expect(new MailService().send(message)).rejects.toThrow(
        '550 domain not verified',
      );
    });
  });

  it('closes the pool on shutdown', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.resend.com';
    const service = new MailService();
    await service.send(message);

    service.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does nothing on shutdown when no transport was ever built', () => {
    expect(() => new MailService().onModuleDestroy()).not.toThrow();
    expect(close).not.toHaveBeenCalled();
  });
});
