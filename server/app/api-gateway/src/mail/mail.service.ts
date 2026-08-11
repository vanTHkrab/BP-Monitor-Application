import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { isProduction } from '../env';

/** One outbound message. `html` is optional; `text` never is — see below. */
export interface MailMessage {
  to: string;
  subject: string;
  /**
   * The plain-text part. Required, because a text-less message is scored as
   * suspicious by most filters and is unreadable in a text-only client.
   */
  text: string;
  /**
   * The HTML part. Worth sending even for a six-digit code: a text-only body
   * whose entire content is a number is a common spam trigger.
   */
  html?: string;
}

/**
 * The narrow contract `better-auth.ts` depends on.
 *
 * It takes this interface rather than the class so the auth configuration is
 * coupled to "something that sends mail" instead of to nodemailer — and so a
 * test double is five lines. See `better-auth.provider.ts` for the wiring.
 */
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** Used when `MAIL_FROM` is unset. Real providers reject it — deliberately. */
const FALLBACK_FROM = 'BP Monitor <no-reply@localhost>';

const DEFAULT_SMTP_PORT = 587;

/**
 * SMTP delivery for everything this gateway emails.
 *
 * Lives in its own module rather than inside `auth/better-auth.ts` for one
 * reason that matters more than tidiness: `better-auth.ts` imports ESM-only
 * packages that the CJS Jest setup cannot parse, so nothing declared in it can
 * be unit-tested. Keeping the send path here — where the only import is
 * nodemailer, which is CJS — is the same isolation trick as
 * `auth/android-origin.ts` and `push/expo-push.client.ts`.
 *
 * Unconfigured behaviour is unchanged from the stub this replaces: throw in
 * production, log in development. A password-reset code dropped silently on
 * the floor is worse than a request that fails loudly, and the development log
 * carries a live credential, so the log branch stays behind `isProduction()`.
 */
@Injectable()
export class MailService implements MailSender, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);

  /**
   * Built on first use and reused for the process.
   *
   * `sendResetPassword` and `sendVerificationOTP` are awaited inside a request
   * the user is watching, and a fresh TLS handshake per send adds seconds to
   * it. Caching also means `SMTP_*` is read once: changing it needs a restart,
   * which is the same contract every other env var here has.
   */
  private transporter: Transporter | null = null;

  async send(message: MailMessage): Promise<void> {
    const transporter = this.transport();

    if (!transporter) {
      if (isProduction()) {
        throw new Error(
          'SMTP_HOST is not set, so no email can be delivered. Email ' +
            'verification and password reset are broken. See ' +
            'docs/guides/email-delivery-setup.md.',
        );
      }

      // Development only. The body carries a reset link or a one-time code —
      // a live credential — so this must never run in production.
      this.logger.debug(
        `email -> ${message.to}: ${message.subject} | ${message.text}`,
      );
      return;
    }

    await transporter.sendMail({
      from: process.env.MAIL_FROM?.trim() || FALLBACK_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  /** Closes the pooled sockets so a rolling deploy does not leak them. */
  onModuleDestroy(): void {
    this.transporter?.close();
    this.transporter = null;
  }

  /** `null` when no `SMTP_HOST` is configured — the caller decides what that means. */
  private transport(): Transporter | null {
    const host = process.env.SMTP_HOST?.trim();
    if (!host) return null;
    if (this.transporter) return this.transporter;

    const port = smtpPort();
    const user = process.env.SMTP_USER?.trim();

    this.transporter = createTransport({
      host,
      port,
      // 465 is implicit TLS. 587 upgrades via STARTTLS and must stay false —
      // `secure: true` on 587 hangs until the connection timeout rather than
      // failing with anything that names the cause.
      secure: port === 465,
      // `undefined`, not a pair of empty strings: a local Mailpit accepts no
      // AUTH at all and rejects an incomplete exchange.
      auth: user ? { user, pass: process.env.SMTP_PASSWORD ?? '' } : undefined,
      pool: true,
      maxConnections: 3,
      // Short on purpose. Every one of these sends happens inside a request a
      // user is waiting on, so a dead SMTP host must fail in seconds rather
      // than hold the connection open for nodemailer's multi-minute defaults.
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });

    return this.transporter;
  }
}

/**
 * Parsed rather than compared as a string, so `SMTP_PORT=465 ` with a stray
 * space still selects implicit TLS. Rejects nonsense at the first send instead
 * of letting `Number('smtp')` reach nodemailer as `NaN`, which surfaces as a
 * connection error naming no port at all.
 */
function smtpPort(): number {
  const raw = process.env.SMTP_PORT?.trim();
  if (!raw) return DEFAULT_SMTP_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `SMTP_PORT is not a valid port number: "${raw}". Use 587 (STARTTLS) ` +
        'or 465 (implicit TLS); outbound 25 is blocked by essentially every ' +
        'cloud provider.',
    );
  }

  return port;
}
