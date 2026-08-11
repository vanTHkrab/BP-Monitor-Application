---
title: Wiring up email delivery
description: Choosing and configuring an SMTP provider so email OTP verification and password reset actually send, and what still has to be built before they can.
status: current
updated: 2026-08-11
owner: gateway
---

# Wiring up email delivery

The gateway has **no mail provider**. `deliverEmail()` in
[`better-auth.ts`](../../server/app/api-gateway/src/auth/better-auth.ts) logs
the message in development and **throws in production**, deliberately — a
password-reset link dropped silently on the floor is worse than a request that
fails loudly.

This guide is the change that closes it: pick a provider, verify a domain,
replace one function body, and forward five environment variables.

## What is blocked until this is done

| Flow | Server call site | Client |
| --- | --- | --- |
| Email OTP verification | `emailOTP.sendVerificationOTP` | [`app/(auth)/verify-email.tsx`](../../client/src/app/%28auth%29/verify-email.tsx) — built and reachable |
| Password reset | `emailOTP` `forget-password` type | [`app/(auth)/forgot-password.tsx`](../../client/src/app/%28auth%29/forgot-password.tsx) — built and reachable |
| Google account linking | gated by `emailVerified` | no UI yet, blocked separately on OAuth credentials |

Both mobile screens are finished and wired against endpoints that already
exist. They fail at exactly one point: the mail never leaves the gateway.

## Decisions already made

**`nodemailer` over a provider SDK.** SMTP is the one interface every provider
offers, so switching providers becomes four environment variables rather than
a dependency swap. The cost is a slower handshake than an HTTPS API and no
delivery-status callbacks.

**Resend as the first provider.** Free tier covers this project's volume many
times over (transactional only — one email per registration and per reset),
the dashboard shows per-message delivery status which is what makes "the OTP
never arrived" debuggable, and there is no sandbox-exit ticket to wait on.
Nothing in the code depends on it; see "Switching providers" below.

**A six-digit code, not a reset link.** A link would open the system browser
against a gateway that serves no HTML — there is nowhere for it to land, and
building a web page plus a deep link back into the app is strictly more work
than the OTP flow the project already uses for email verification. See
[AUTH-better-auth-identity.md](../architecture/AUTH-better-auth-identity.md).

## Step 1 — verify a sending domain

Do this **first**. Until the domain is verified, Resend only sends from
`onboarding@resend.dev` and only to the account owner's own address, so
testing the mobile flow with anyone else's email produces "the code never
arrived" — indistinguishable from a broken server.

1. Add the domain in the Resend dashboard.
2. Paste the records it gives you into Cloudflare. Expect three, normally on a
   `send.<domain>` subdomain: an `MX` for bounces, a `TXT` for SPF, and a
   `TXT` at `resend._domainkey` for DKIM.
3. Leave them unproxied. `TXT` and `MX` cannot be proxied anyway, but a `CNAME`
   created with the orange cloud on will fail verification without saying why.
4. Wait for the dashboard to report verified.

Two things that collide here:

- **Cloudflare Email Routing**, if enabled on this zone, already owns `MX`
  records. A record on a `send.` subdomain does not clash; one on the apex
  does. Check before adding.
- **An existing strict `_dmarc`** (`p=reject`) that does not account for
  Resend will have receivers drop the mail while Resend reports it delivered —
  a failure invisible from our side. If there is no `_dmarc` record yet, start
  with `v=DMARC1; p=none;` and tighten later.

The domain used for `DOMAIN_NAME` (`api.<domain>`) is a different subdomain
and is unaffected; mail records and the Cloudflare Tunnel do not interact.

Smoke-test with `delivered@resend.dev` before using a real inbox.

## Step 2 — install and implement

From `server/app/api-gateway/` (never the repo root):

```bash
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

`nodemailer` is CJS, so it needs none of the ESM isolation that
`auth/android-origin.ts` and `push/expo-push.client.ts` exist for.

Then replace the body of `deliverEmail()` in `src/auth/better-auth.ts`. The
transporter must be built **once and reused** — `sendResetPassword` and
`sendVerificationOTP` are awaited inside a request the user is watching, and a
fresh TLS handshake per send adds seconds to it.

```ts
import { createTransport, type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function mailTransport(): Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  transporter ??= createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    // 465 is implicit TLS; 587 upgrades via STARTTLS and must stay false.
    secure: process.env.SMTP_PORT === '465',
    // Undefined, not empty strings: a local Mailpit accepts no AUTH at all
    // and rejects an incomplete exchange.
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
      : undefined,
    pool: true,
    maxConnections: 3,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });

  return transporter;
}
```

`deliverEmail` then sends through it, keeping both existing branches: throw in
production when `SMTP_HOST` is unset, log in development. The development log
carries a live credential — a reset code — and must never reach a production
log, which is what the `isProduction()` gate protects.

Send `html` as well as `text`. A text-only body whose entire content is a
six-digit number is a common spam-filter trigger.

## Step 3 — configure

Five variables, and they must be added in **three** places. Setting them in
`.env` alone is not enough: `docker-compose.yml` declares environment
variables one by one rather than passing the file through, and a variable
missing from that list simply never reaches the container. This is the same
failure that had `BETTER_AUTH_URL` unset in every containerised environment
while `/api/auth/*` returned 404.

| File | What to add |
| --- | --- |
| [`server/app/api-gateway/.env.example`](../../server/app/api-gateway/.env.example) | the five names, commented |
| [`infra/docker-compose/.env.example`](../../infra/docker-compose/.env.example) | the same |
| [`infra/docker-compose/docker-compose.yml`](../../infra/docker-compose/docker-compose.yml) | the `environment:` block of `api-gateway` |

```yaml
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASSWORD: ${SMTP_PASSWORD:-}
      MAIL_FROM: ${MAIL_FROM:-}
```

Resend's values:

```bash
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend                 # the literal string, not an email address
SMTP_PASSWORD=re_xxxxxxxxxxxx    # an API key with Sending access
MAIL_FROM=BP Monitor <no-reply@yourdomain.com>
```

Also add the five rows to
[environment-variables.md](../reference/environment-variables.md), in both the
api-gateway table and the production table, in the same change.

### Networking

Nothing to configure. `bp-net` is a plain bridge and outbound HTTPS/SMTP
already works from it — ai-service downloads model artifacts from R2 at
startup over the same path. No `dns:`, no `extra_hosts:`, no published port.

Port 587 or 465 only. Outbound port 25 is blocked at the cloud-provider level
on essentially every host, and that block is outside Docker — no Compose
setting can work around it. The symptom is `ETIMEDOUT` after the connect
timeout, which reads like a network problem rather than a wrong port.

The one case that *does* need network configuration is an SMTP server running
on the Docker host rather than in the stack. `SMTP_HOST=localhost` inside the
container resolves to the container, not the host — the same trap that had
ai-service subscribing to a Redis nobody published to. Use
`host.docker.internal` plus `extra_hosts: ["host.docker.internal:host-gateway"]`,
which Linux needs and macOS does not.

## Step 4 — testing in development

Two mechanisms, and they are complementary rather than alternatives:

- **Leave `SMTP_HOST` unset** and the existing development branch logs the OTP
  or reset link to the console. A fresh checkout keeps working with no
  configuration.
- **Add Mailpit to the dev stack** to exercise the real `nodemailer` path
  without anything leaving the network. It speaks SMTP on 1025 and serves an
  inbox on 8025.

Mailpit belongs in
[`docker-compose.dev.yml`](../../infra/docker-compose/docker-compose.dev.yml)
**only**, never the base file — an override file can change a service but
cannot delete one, so anything defined in the base file starts in the
production stack too. This is the same constraint that keeps `web` out of the
base file.

Point the gateway at it with `SMTP_HOST=mailpit`, `SMTP_PORT=1025` and no
credentials.

## Still to do on the gateway

The two mobile screens work against endpoints Better Auth's `emailOTP` plugin
already mounts, so no resolver work is needed. These two are not optional
before production, though:

1. **Rate-limit `/forget-password/email-otp`.** `customRules` in
   `better-auth.ts` throttles `/email-otp/send-verification-otp` at 3 per
   15 min but not the password-reset request, which is equally unauthenticated
   and equally able to spend the mail quota. Add it alongside.
2. **Differentiate the subject by `type`.** `sendVerificationOTP` receives
   `{ email, otp, type }` and currently ignores `type`, so a password-reset
   code arrives with the subject "รหัสยืนยัน BP Monitor".

## Noticed, not in scope

**A password reset does not revoke the gateway's own view of a session
cleanly.** `revokeSessionsOnPasswordReset` is honoured on the OTP reset path
and `deleteUserSessions` **deletes** the `user_sessions` rows. `GqlAuthGuard`
rejects the token afterwards, so this is safe — but sign-out elsewhere flips
`isActive = false` and keeps the row for the "login sessions" screen. A reset
therefore erases that history instead of showing those devices as revoked.

**Resetting a password also verifies the email.** Better Auth sets
`emailVerified = true` on a successful OTP reset, on the reasoning that
receiving the code proves control of the address. That is a side door into
the flag that gates Google account linking. It is correct, but it is not
obvious from the reset screen.

## Switching providers

Only the four SMTP values change. Hosts, for reference:

| Provider | Host | Username |
| --- | --- | --- |
| Resend | `smtp.resend.com` | `resend` |
| Brevo | `smtp-relay.brevo.com` | the login email |
| Gmail | `smtp.gmail.com` | the Gmail address, with an **App Password** |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | an SES SMTP credential, not an IAM key |

Gmail additionally locks `MAIL_FROM` to the account's own address and ties
production password reset to one person's Google account; SES requires a
sandbox-exit request before it will deliver to unverified addresses.
