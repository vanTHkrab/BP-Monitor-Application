---
title: Troubleshooting
description: Failures that look like something other than what they are, grouped by where the symptom shows up.
status: current
updated: 2026-08-07
owner: cross
---

# Troubleshooting

Failures whose symptom points somewhere other than the cause. Ordinary errors
that say what they mean are not listed.

## Tooling

### Jest dies with ENOSPC

**Symptom.** Every Jest run in `client/` or `api-gateway/` aborts before a
single test executes. Reads like the suite is broken.

**Cause.** watchman shares the machine's inotify budget with Metro and with
`client-old/`'s `node_modules`. When the budget runs out, watchman enters a
poisoned state and takes Jest down with it.

**Fix.** Pass `--watchman=false`. A one-shot run never needed it — watchman
only accelerates file crawling for `--watch`.

```bash
cd server/app/api-gateway && pnpm exec jest --watchman=false
```

`client/`'s `test` script already passes the flag. The gateway's does not, so
use `pnpm exec jest --watchman=false` there rather than `pnpm test`.

### A config-plugin change has no effect

**Symptom.** You edited `client/modules/bp-vision/plugin/withBpVisionModels.js`
and nothing changed after a Metro reload.

**Cause.** Config plugins run at **prebuild** time only.

**Fix.** `cd client && pnpm expo prebuild -p android`.

**If that command fails with a Firebase error instead**, you have hit a
different problem: `app.json` sets `android.googleServicesFile`, and prebuild
throws when the file is absent. Any Android build needs
`client/google-services.json`, which is not in the repo yet — see step 2 of
[push-notifications-setup.md](./push-notifications-setup.md). The error names
Firebase, but it blocks all Android native work, not just push.

> **Note:** `client/android/` is generated output and is **untracked** — it is
> covered by `client/.gitignore:47`. It was tracked for a period, which broke
> EAS Build silently (`eas-cli` reads managed-vs-bare from whether the native
> files are git-ignored, so a tracked `android/` makes it skip prebuild and
> drop every `app.json` native setting, push credentials included). Do not
> re-add it — `git rm -r --cached client/android` is the undo, and
> [push-notifications-setup.md](./push-notifications-setup.md) has the
> detection commands.

## Mobile client

### `pnpm start` fails on a model hash mismatch

**Symptom.** `verify-models` fails before Metro starts.

**Cause.** The bundled copies under `client/assets/models/` disagree with
`server/app/ai-service/models/EXPECTED_HASHES.json` — usually a retrain where
only one side was updated.

**Fix.** `cd client && pnpm sync-yolo-model`. If the manifest is what is
stale, regenerate it and re-upload to R2 in the same change. Do not bypass the
check: it is the only thing keeping the phone and the server on the same
detector ([ADR-002](../decisions/ADR-002-detection-taxonomy-wire-contract.md)).

### The app cannot reach the gateway from a physical device

**Cause.** `EXPO_PUBLIC_API_URL` is unset or points at `localhost`. A device
on the LAN cannot reach the dev machine's loopback.

**Fix.** Set your machine's LAN IP in `client/.env`, **including the path**:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000/graphql
```

### `verify-graphql` fails but TypeScript and Jest pass

**Cause.** Working as designed. An operation in `src/` selects a field the
gateway's schema does not have. TypeScript sees a template string and Jest
mocks the transport, so neither can catch it.

**Fix.** Fix the selection, or — if the field is genuinely new — start the
gateway (`pnpm start:dev`) to regenerate `src/schema.gql` and commit it with
the client change.

### A binary upload throws at runtime despite type-checking

**Cause.** `new Blob([Uint8Array])` compiles fine and throws on native.

**Fix.** Use `uploadAsync` from `expo-file-system/legacy`, streaming from
disk — see `client/src/services/upload-image.ts`.

## API gateway

### `schema.gql` changes keep reverting

**Cause.** It is generated on boot by `autoSchemaFile`. Hand edits are
overwritten.

**Fix.** Edit the `*.types.ts` / resolver, run `pnpm start:dev` briefly, commit
the regenerated file.

### A new input field 400s before reaching the resolver

**Cause.** `ValidationPipe` runs with `forbidNonWhitelisted`. `@Field(() =>
MyEnum)` is GraphQL metadata only — without a class-validator decorator the
field is non-whitelisted and gets rejected.

**Fix.** Add the class-validator decorator (`@IsEnum(MyEnum)`, `@IsString()`,
…) to every `@InputType` field.

### GraphiQL is missing in a deployed environment

**Cause.** Two independent gates. `GRAPHIQL_ENABLED` defaults to on
everywhere *except* `NODE_ENV=production`, and the prod nginx config puts
`/graphiql` behind Basic Auth.

**Fix.** Set `GRAPHIQL_ENABLED` to `1`, `true`, `yes`, or `on` **and**
authenticate. Both are deliberate; they fail differently.

**If it is still missing with the variable set**, check the value itself.
Only that four-value set turns GraphiQL on (case-insensitive, surrounding
whitespace trimmed); every other non-empty value — `enabled`, `2`, `yep`, a
stray quote — resolves to **off** rather than being read as truthy. That is
the deliberate fail-safe direction: it is what stops `GRAPHIQL_ENABLED=false`
from serving a mutation-capable schema explorer against live patient data.
An empty value (`GRAPHIQL_ENABLED=`) is treated as unset and defers to
`NODE_ENV`.

### Passkey registration fails on-device with a server-looking error

**Cause.** Passkeys need four things to agree: `PASSKEY_RP_ID` (a bare
registered domain — not an IP, not a port, not a scheme), the signing-key
SHA-256 fingerprint, a real HTTPS domain serving
`/.well-known/assetlinks.json`, and the app's package name. Three of four
fails at the authenticator, before any request reaches the gateway.

**Fix.** Verify all four. Passkeys cannot work against a LAN dev address at
all. The gateway hides the feature when unconfigured, and the client branches
on `securityOverview.passkeySupported` rather than probing.

## AI service

### `/health` is `ok` but no analysis ever completes

**Cause.** A green health check does not mean the pipeline works. The Redis
subscription is established during lifespan startup; if Redis was unreachable,
HTTP still serves.

**Fix.** Check `REDIS_URL`, restart the service, and confirm the boot log
reaches "AI service ready".

### The service refuses to start

| Log | Cause |
| --- | --- |
| Placeholder URL rejected | `AI_MODELS_R2_BASE_URL` is unset or still `REPLACE_ME` |
| ONNX session creation failed | Model missing or corrupt. Fail-fast is deliberate — serving mock readings would be worse ([ADR-005](../decisions/ADR-005-model-weights-from-r2.md)) |
| Opset error | A model was re-exported above the `onnxruntime` floor. Bump the pin ([ADR-001](../decisions/ADR-001-onnx-runtime-over-ultralytics.md)) |

### Error replies from the pipeline

| Reply | Cause |
| --- | --- |
| `missing imageUrl` | The gateway published without presigning first |
| `unknown engine: <name>` | `ocrEngine` is not `crnn` / `ssocr_cnn` / `ssocr`. Deliberately an error, not a fallback — a silent fallback would mislabel the comparison telemetry |
| `Discarding non-JSON message` | A publisher sent the wrong payload shape; check that both sides are on the same deploy |
| Fetch 403 | The presigned URL expired while the job sat in the queue |

### The gateway times out on `analyzeBPImage`

**Cause.** The Redis channels are typed only by convention. A field rename on
one side plus a stale deploy on the other means the gateway polls forever for
a reply that never matches. **Nothing logs an error on either side.**

**Fix.** Confirm both sides are on the same commit. This is why cross-cutting
rule 5 exists.

## Docker and deploy

### `/` or `/graphiql` returns 500 in prod

**Cause.** `infra/nginx/auth/.htpasswd` does not exist. It is gitignored;
only the directory is tracked.

**Fix.** Generate it — see [deploy.md](./deploy.md).

### A container cannot reach another service

**Cause.** `localhost` inside a container is that container. `web`'s defaults
(`http://localhost:3000` / `:8000`) only make sense outside Docker.

**Fix.** Use Compose service names: `postgres`, `redis`, `api-gateway`,
`ai-service`.

### Certificate issuance fails on a fresh host

**Cause.** HTTP-01 validates by inbound request. DNS must resolve and port 80
must be open **before** `init-letsencrypt.sh` runs.

**Fix.** Fix DNS and the firewall, then re-run the script — it is idempotent.
Set `CERTBOT_STAGING=1` to rehearse without burning the production CA's
per-domain rate limit.
