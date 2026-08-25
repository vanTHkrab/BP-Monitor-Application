---
title: Google Sign-In Setup
description: The four credential values, the one rule that ties them together, and why every misconfiguration produces the same unhelpful error.
status: current
updated: 2026-08-25
owner: cross
---

# Google Sign-In Setup

Everything in the code path works and is covered by tests. What breaks is
configuration, and **every configuration mistake produces the same
`DEVELOPER_ERROR`** with no further detail — from Google, by design, so an
attacker cannot probe your project setup. This guide exists because that error
is uninformative and the answers are not guessable.

That is true of everything on the *device* side. The two failures that do not
look like it — a button that never appears, and a gateway with no provider
registered — are the ones production hit, and both are covered below.

Written after two debugging sessions: one that cost several hours getting a
dev build working, and one after 1.2.0 reached real users and failed anyway.
The wrong turns from both are recorded at the end.

## The four values

| Variable | File | What goes in it |
| --- | --- | --- |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | `client/.env` | The **Web** client ID |
| `GOOGLE_CLIENT_ID` | `server/app/api-gateway/.env` | The same Web client ID |
| `GOOGLE_CLIENT_SECRET` | `server/app/api-gateway/.env` | That Web client's secret |
| `GOOGLE_ANDROID_CLIENT_ID` | `server/app/api-gateway/.env` | The **Android** client ID |

**The client `.env` takes the *web* client ID even though the app is Android.**
Credential Manager mints an ID token whose audience is the web client; the
Android client exists only to tie the request to the app's signing certificate.
Putting the Android ID there yields a token the gateway rejects as an invalid
audience, which reads like a server bug.

The two kinds are indistinguishable by sight — both end in
`.apps.googleusercontent.com`. Only the **Type** column in the Google Cloud
Console credentials list tells them apart. An Android client also cannot have a
secret, so a client ID with no secret beside it is an Android one.

## The rule that ties them together

**Every client ID must belong to the same Google Cloud project as
`client/google-services.json`.** Google rejects a cross-project combination
with `DEVELOPER_ERROR` and says nothing else.

This is easy to get wrong because creating a Web client by hand in Cloud
Console does not put it in the Firebase project unless you selected that
project first. The reliable route is to let Firebase create it:

1. **Firebase Console** → your project → **Authentication → Sign-in method →
   enable Google.** This is what creates the Web OAuth client.
2. **Project settings → your Android app → Add fingerprint**, with the SHA-1
   of the key that signs the build you are testing (see below).
3. Re-download `google-services.json`. It should now carry **at least two**
   `oauth_client` entries — one `client_type: 1` (Android) and one
   `client_type: 3` (Web). An empty `oauth_client: []` is the state that
   produces `DEVELOPER_ERROR`.
4. Read the IDs back out of that file rather than from the console, so the
   `.env` values cannot drift from what the app was built with.

## Which SHA-1

**This project does not use `~/.android/debug.keystore`.** It ships its own at
`client/android/app/debug.keystore`, and `android/app/build.gradle` points both
the debug *and* release signing configs at it. Reading the machine-wide default
gives a fingerprint the app was never signed with — the third wrong turn in the
session that produced this guide.

```bash
keytool -list -v -keystore client/android/app/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA1:
```

Debug, EAS development, EAS preview, and Play App Signing are **four different
keys**. Each needs its own Android OAuth client registered against its own
SHA-1 in Firebase. A build signed by a key Firebase has never seen fails the
same way an unconfigured project does.

For an EAS-built APK the key is EAS's, not this one:

```bash
cd client && npx eas credentials -p android
```

### Play adds one more key, and it is the one users get

`eas.json`'s `production` profile builds an **app-bundle**, which means Play
re-signs it before it reaches a device. The certificate on the installed app is
therefore **Google's**, not EAS's — a fingerprint that exists nowhere on your
machine and that nothing in this repo can tell you.

**Play Console → your app → Test and release → Setup → App integrity → App
signing.** That page shows two certificates and they are not interchangeable:

| Certificate | Signs what | Register it? |
| --- | --- | --- |
| **App signing key** | every install that came from Play | **Yes — this is the one production needs** |
| **Upload key** | what EAS hands to Play | Yes, for testing a build before Play re-signs it |

Copy the SHA-1 from each, add both in Firebase, re-download
`google-services.json`, and **rebuild** — the file is compiled into the
artifact, so a build already on Play is not fixed by uploading a new one.

Registering only the debug and EAS keys is the state this project shipped 1.2.0
in, and it fails on exactly one build: the one real users install.

If the app is distributed as a bare APK rather than through Play, none of this
applies — EAS's key is the final one.

### EAS does not read `client/.env`

`eas.json` names `"environment": "production"`, so the build takes its
`EXPO_PUBLIC_*` values from the **EAS** environment, server-side. A local
`.env` that makes the button appear in dev has no bearing on a store build:

```bash
cd client && npx eas env:list --environment production
```

`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` missing there does not produce
`DEVELOPER_ERROR` — `isGoogleSignInConfigured()` returns false and **the button
is simply absent**, which is easy to read as a rendering bug rather than a
missing variable. The `preview` profile has its own environment and can differ
from `production`.

### Reading the fingerprint off what is actually installed

The decisive check, when the answer matters more than the theory. `keytool
-printcert -jarfile` will not work — modern APKs use signature scheme v2/v3,
which it cannot read:

```bash
adb pull "$(adb shell pm path com.project.bpmobile | head -1 | tr -d '\r' | sed 's/package://')" /tmp/installed.apk
"$(ls ~/Android/Sdk/build-tools/*/apksigner | tail -1)" verify --print-certs /tmp/installed.apk | grep -i 'SHA-1'
```

## Verify before rebuilding

`google-services.json` is compiled into the APK at build time. A Metro reload
does not pick up a new one — you need `expo prebuild -p android` and a rebuild.
Check the file first, so a wrong one does not cost a build:

```bash
cd client && python3 -c "
import json
d = json.load(open('google-services.json'))
pn = d['project_info']['project_number']
oc = d['client'][0]['oauth_client']
def unquote(v):
    v = v.strip()
    if len(v) > 1 and v[0] == v[-1] and v[0] in '\"\'':
        v = v[1:-1]
    return v.strip()
env = {k.strip(): unquote(v) for k, v in (l.strip().split('=', 1) for l in open('.env') if '=' in l and not l.strip().startswith('#'))}
web = [o for o in oc if o['client_type'] == 3]
w = env.get('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', '')
ok = lambda b: 'OK  ' if b else 'FAIL'
print(ok(any(o['client_type'] == 1 for o in oc)), 'android client present')
print(ok(bool(web)), 'web client present')
print(ok(w and any(o['client_id'] == w for o in web)), '.env web id matches the file')
print(ok(w.split('-')[0] == pn), 'same Google Cloud project')
"
```

All four must read `OK`. Then confirm the Android entry's `certificate_hash`
matches the SHA-1 of the build you are installing, lower-cased with the colons
removed.

The `unquote` is not decoration. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="…"` is
valid and works — dotenv strips the quotes before Expo ever sees the value —
but a script that splits on `=` and stops keeps them, and then reports a
correct configuration as two `FAIL` lines including "different Google Cloud
project". The first version of this check did exactly that. **EAS's
environment is the opposite case**: paste a quoted value into
`eas env:create` and the quotes become part of the string, so strip them there
rather than copying the `.env` line verbatim.

## Reading the failure

The client distinguishes three outcomes and they mean different things:

| What you see | Where it died | Usual cause |
| --- | --- | --- |
| Account picker opens, then closes with **no message** | No ID token came back, and `use-google-sign-in.ts` treats that as a cancellation | SHA-1 or Android client mismatch |
| **`DEVELOPER_ERROR`** in the Metro log | `GoogleSignin.signIn()` threw | Empty `oauth_client`, wrong project, unregistered SHA-1 |
| A red banner, and a line in the **gateway** log | The token reached the server and was refused | Audience mismatch, provider not configured, account linking refused |

The silent case is the trap: a signing-key mismatch looks exactly like the user
changing their mind.

**If a request never reaches the gateway at all, the problem is on the device.**
Confirm the transport separately by signing in with a phone number and password
— if that works, the gateway is reachable and the Google mutation is dying
before it is sent.

### What the gateway logs

**At boot**, `googleProvider()` says whether it registered. Read this before
reproducing anything — it answers the question without a device:

- `GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not both set …` — no provider.
  Every attempt 401s. **The mobile button stays visible**, because it is gated
  on a build-time value on a different machine.
- `GOOGLE_ANDROID_CLIENT_ID is not set …` — the provider is registered and the
  browser flow works, but the app's audience is not accepted, so One Tap alone
  fails. The worse of the two: the gateway looks correctly configured.

Silence from both means the credentials arrived. In a container:

```bash
docker compose exec api-gateway printenv | grep GOOGLE   # expect three lines
```

`googleProvider()` reads `process.env` once at construction, so a `.env` edit
needs the container **recreated**, not restarted.

**Per request**, both failure paths in `AuthService.loginWithGoogleIdToken`
report themselves:

- `Better Auth call failed: <reason>` — the token was rejected. The reason is
  Better Auth's own and names the actual problem.
- `signInSocial returned no session — the ID-token branch was not taken` — the
  call *succeeded* and returned the browser-redirect shape, which means the
  google provider is not configured on the gateway. Check that
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` reached the process, and
  **restart it** — `googleProvider()` reads `process.env` once at construction
  and returns `{}` when either is missing, which unregisters the provider
  entirely.

The message the user sees stays deliberately vague in both cases; a sign-in
failure must not tell the caller which failure it was.

## Six wrong turns, so they are not repeated

1. **`~/.android/debug.keystore` is not this project's key.** It has its own at
   `client/android/app/debug.keystore`. Registering the machine default in
   Firebase produces a fingerprint the app was never signed with.
2. **A Web client created by hand can land in a different Cloud project** than
   the Firebase one that generated `google-services.json`. Everything looks
   correctly filled in and nothing works.
3. **`google-services.json` with `oauth_client: []`** is the state before
   Google sign-in has been enabled in Firebase Authentication. Adding a SHA-1
   alone does not populate it.
4. **A new `google-services.json` needs a rebuild, not a reload.** It is
   compiled into the APK.
5. **Getting it working on a dev device says nothing about production.** The
   two differ in three independent places at once — a different signing key
   (Play's), a different source of `EXPO_PUBLIC_*` (EAS's environment), and a
   different gateway `.env`. 1.2.0 shipped verified on a debug build and
   failed on the first production install.
6. **A deploy does not carry `.env` with it.** `GOOGLE_*` was added to
   `infra/docker-compose/.env.example` in the same change that turned the
   feature on, and an example file is not a deployed file.

## What ships today

`GOOGLE_SIGN_IN_ENABLED` in
[`client/src/modules/auth/lib/feature-flags.ts`](../../client/src/modules/auth/lib/feature-flags.ts)
is `true` as of 1.2.0. The button also requires
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to be set — both conditions, so a build
without credentials hides the button rather than offering one that fails.

Two known rough edges, both recorded on that flag's docblock: the completion
form is one screen short of what was designed, and
`googleSignInRefusalMessage()` is written but rendered nowhere, so a refusal
caused by an unverified email reaches the user as a generic "try again".

## See also

- [`docs/project/AUTH-google-oauth-plan.md`](../project/AUTH-google-oauth-plan.md)
  — the four gaps, and what closing each one required
- [`docs/architecture/AUTH-better-auth-identity.md`](../architecture/AUTH-better-auth-identity.md)
  — why Better Auth owns the identity model, and why `users.phone` is nullable
- [`docs/guides/push-notifications-setup.md`](./push-notifications-setup.md)
  — the same shape of problem for a different Google service
