---
title: Email delivery
description: How the gateway sends email over SMTP, and the DNS and environment work needed to make it deliver from a real provider.
status: current
updated: 2026-08-11
owner: gateway
---

# Email delivery

The gateway sends email over SMTP through
[`MailService`](../../server/app/api-gateway/src/mail/mail.service.ts).
**Configuring it is one environment variable plus DNS** — everything below the
"install and implement" line is already built.

With `SMTP_HOST` unset, `MailService` logs the message in development and
**throws in production**, deliberately: a password-reset code dropped silently
on the floor is worse than a request that fails loudly.

## What this powers

| Flow | Server call site | Client |
| --- | --- | --- |
| Email OTP verification | `emailOTP.sendVerificationOTP` | [`app/(auth)/verify-email.tsx`](../../client/src/app/%28auth%29/verify-email.tsx) |
| Password reset | `emailOTP` `forget-password` type | [`app/(auth)/forgot-password.tsx`](../../client/src/app/%28auth%29/forgot-password.tsx) |
| Google account linking | gated by `emailVerified` | no UI yet, blocked separately on OAuth credentials |

Both mobile screens are finished and wired against endpoints that already
exist. Until a provider is configured, they fail at exactly one point: the mail
never leaves the gateway.

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

## Step 2 — how the send path is built

Already done; this section is here so the shape is not re-derived. `nodemailer`
is a direct dependency of `server/app/api-gateway/`, and `MailModule` is
imported by `AuthModule`.

Three files, under `server/app/api-gateway/src/mail/`:

| File | Holds |
| --- | --- |
| [`mail.service.ts`](../../server/app/api-gateway/src/mail/mail.service.ts) | the transport and the one `send()` method, plus the `MailSender` interface |
| [`mail.templates.ts`](../../server/app/api-gateway/src/mail/mail.templates.ts) | every subject and body, Thai, text **and** HTML |
| [`mail.module.ts`](../../server/app/api-gateway/src/mail/mail.module.ts) | the provider; not `@Global()` on purpose |

### Why it is a module and not a function in `better-auth.ts`

`better-auth.ts` imports ESM-only packages that the CJS Jest setup cannot
parse, so **nothing declared in that file can be unit-tested**. Putting the
send path and the copy in their own module is what makes both reachable from a
spec — the same isolation as `auth/android-origin.ts` and
`push/expo-push.client.ts`.

That creates a wiring problem, because `createBetterAuth()` runs *outside*
Nest's DI graph: [`better-auth.provider.ts`](../../server/app/api-gateway/src/auth/better-auth.provider.ts)
calls it from a `useFactory`. The resolution is to pass the sender in as an
argument — the factory injects `MailService` and hands it over, and
`createBetterAuth` accepts the narrow `MailSender` interface rather than the
class. Importing `MailService` inside `better-auth.ts` and constructing one
would be wrong twice: a second instance means a second nodemailer pool that
`onModuleDestroy` never closes, and the send path would again be reachable only
through a file Jest cannot load.

### What the transport does, and why

- **Built once and reused** (`pool: true`, `maxConnections: 3`).
  `sendResetPassword` and `sendVerificationOTP` are awaited inside a request
  the user is watching, and a fresh TLS handshake per send adds seconds to it.
  A consequence worth knowing: `SMTP_*` is read once, so changing it needs a
  restart.
- **Short timeouts** (5s connect, 5s greeting, 10s socket) for the same reason.
  nodemailer's defaults are minutes.
- **`secure` only on 465.** 587 upgrades via STARTTLS; `secure: true` there
  hangs until the connection timeout rather than failing with anything that
  names the cause. The port is parsed as a number, and a non-numeric value
  throws instead of reaching nodemailer as `NaN`.
- **`auth: undefined`, not empty strings,** when `SMTP_USER` is unset — a local
  Mailpit accepts no AUTH at all and rejects an incomplete exchange.
- **`onModuleDestroy` closes the pool** so a rolling deploy does not leak
  sockets.
- **Both `text` and `html` on every message.** A text-only body whose entire
  content is a six-digit number is a common spam-filter trigger.

The unconfigured branch is unchanged from the stub this replaced: throw in
production when `SMTP_HOST` is unset, `logger.debug` in development. The
development log carries a live credential — a reset code — and must never reach
a production log, which is what the `isProduction()` gate protects.

### Subjects differ by OTP purpose

`sendVerificationOTP` receives `{ email, otp, type }`, and `type` selects the
copy in `mail.templates.ts`. Ignoring it — as the first version did — titles a
password-reset code "รหัสยืนยัน BP Monitor", which reads to a user as mail they
did not ask for, in the one flow where that matters most.

The installed plugin issues four types, not three: `sign-in`,
`email-verification`, `forget-password`, and `change-email`. An unrecognised
fifth falls back to the verification copy rather than throwing inside the
request.

Send `html` as well as `text`. A text-only body whose entire content is a
six-digit number is a common spam-filter trigger.

## Step 3 — configure

Five variables. Set them in your own `.env`; the plumbing that carries them is
already in place, in **three** files:

| File | Carries |
| --- | --- |
| [`server/app/api-gateway/.env.example`](../../server/app/api-gateway/.env.example) | the five names, commented |
| [`infra/docker-compose/.env.example`](../../infra/docker-compose/.env.example) | the same |
| [`infra/docker-compose/docker-compose.yml`](../../infra/docker-compose/docker-compose.yml) | the `environment:` block of `api-gateway` |

That third one is the one that is easy to forget when adding a *sixth*
variable: `docker-compose.yml` declares environment variables one by one rather
than passing the file through, so a name missing from that block simply never
reaches the container. This is the same failure that had `BETTER_AUTH_URL`
unset in every containerised environment while `/api/auth/*` returned 404.
`docker-compose.prod.yml` needs no entry of its own — it overlays the base
file, which already forwards all five.

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

All five are documented in
[environment-variables.md](../reference/environment-variables.md), in both the
api-gateway table and the production table. Note what that second table says
about `SMTP_PASSWORD`: it is a live credential sitting in the env file rather
than in a Podman secret, unlike `JWT_SECRET` and the S3 keys beside it.

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

- **Leave `SMTP_HOST` unset** and `MailService` logs the OTP or reset link to
  the console. A fresh checkout keeps working with no configuration.
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

Mailpit is **not** in `docker-compose.dev.yml` yet — adding it is a one-service
change to that file plus the two lines above.

## Rate limiting

Requesting a code is unauthenticated and spends the mail quota, so
`customRules` in `better-auth.ts` budgets it through the same
[`RateLimitService`](../../server/app/api-gateway/src/redis/rate-limit.service.ts)
as the credential routes — 3 requests per 15 minutes, per path:

| Path | Note |
| --- | --- |
| `/email-otp/send-verification-otp` | verification code |
| `/forget-password/email-otp` | password reset — **what the mobile client calls today** |
| `/email-otp/request-password-reset` | password reset, canonical; Better Auth deprecates the row above in its favour |

Both reset paths are listed because they are two routes onto one handler and
rules are keyed by path: limiting only the deprecated alias leaves its
replacement uncapped, and limiting only the canonical one caps nothing the
client actually hits. The cost is two independent counters — a caller willing
to alternate paths gets 6 sends per window rather than 3. Still bounded, and it
collapses back to 3 when the deprecated route is removed.

**`/email-otp/request-email-change` is not limited.** It also sends mail, but
it requires a session, so it is a different threat with a different key and was
left for a change that can think about authenticated quotas properly.

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
