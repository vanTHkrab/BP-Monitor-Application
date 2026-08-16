---
title: Enabling push notifications
description: The Firebase and EAS credential steps that turn the already-built push code into actual delivery, plus the three ways this config fails without saying so.
status: current
updated: 2026-08-07
owner: client
---

# Enabling push notifications

Push is **written and tested on both sides and delivers nothing** until the
steps below are done. Nothing here is a code change — the code shipped in
PR #95 (gateway) and `client/src/modules/notifications/` (client). What is
missing is Firebase project setup and one credential upload, both of which
need Firebase Console access this repo cannot script.

Read "What fails silently" before doing anything. Every item there produces a
**green build and a device that never receives a notification**, which is the
single most expensive failure mode this feature has — one of them has already
happened once in this repo.

## What is already in place

The last four rows are **EAS-side state, not repo state**. They can change
without any commit, so this table is a snapshot dated by the frontmatter, not
a fact about the checkout. Verify with `eas env:list` and `eas credentials`
before relying on them — an earlier revision of this page asserted the
`preview` variable was missing when it had been set for weeks.

| Piece | Where | State |
| --- | --- | --- |
| Token registration | `client/src/modules/notifications/services/push-registration.ts` | Done, covered by test |
| `registerPushToken` / `unregisterPushToken` | `server/app/api-gateway/src/push/` | Done, PR #95 |
| Critical-reading send + 30-min receipt sweep | `server/app/api-gateway/src/push/` | Done, PR #95 |
| `expo-notifications` plugin, five custom sounds | `client/app.json` | Done |
| EAS `projectId` `b5572b71-c303-4b8e-b89e-14007c46ca3c` | `client/app.json` → `extra.eas` | Done |
| Build profiles | `client/eas.json` | Done — this change |
| `android.googleServicesFile` | `client/app.json` | Done — this change |
| `google-services.json` | `client/google-services.json` | **Missing — step 2 below** |
| FCM V1 service-account key on EAS | EAS credentials, not the repo | Believed missing — step 4 below. There is no non-interactive way to read this; confirm with `eas credentials` before assuming |
| `EXPO_PUBLIC_API_URL` for `preview` builds | EAS environment `preview` | Set — but to an ephemeral tunnel URL, see step 5 |
| `EXPO_PUBLIC_API_URL` for `production` builds | EAS environment `production` | **Missing — step 5 below** |

Fixed values you will need:

| Setting | Value |
| --- | --- |
| Android package | `com.project.bpmobile` |
| Expo slug | `bp-mobile-application` |
| Expo owner / account | `bp-monitor-education-project` |
| EAS project id | `b5572b71-c303-4b8e-b89e-14007c46ca3c` |

The Android package must match the Firebase Android app **exactly**. A
mismatch does not error — tokens simply stop issuing and delivery drops.

## The blocked steps

Steps 1–4 need a human with Firebase Console access; step 5 needs EAS access.
Do 1–4 in order — step 4 depends on step 3, and step 2 depends on step 1. Step
5 is independent of Firebase but belongs in the same sitting, because it is the
same kind of console work and it blocks the same builds.

1. **Firebase Console → create or open the project → add an Android app.**
   Enter the package name as exactly `com.project.bpmobile`. Nothing else on
   that form is load-bearing for push.

2. **Download `google-services.json` and place it at `client/google-services.json`.**
   Not `client/android/app/` — see the trap below. Then commit it. This file is
   deliberately committed: it ships inside every APK and carries no secret
   material, and committing it is what keeps CI and fresh clones buildable.

3. **Firebase Console → Project Settings → Service Accounts → Generate new
   private key.** This downloads a JSON file. It **is** secret, it is the half
   that can send on your behalf, and it never enters the repo — not committed,
   not in `.env`, not in an `EXPO_PUBLIC_*` variable.

4. **Upload it to EAS.** From `client/`:

   ```bash
   eas credentials
   ```

   Then: **Android** → **production** → **Google Service Account** → *Manage
   your Google Service Account Key for Push Notifications (FCM V1)* → upload
   the JSON from step 3.

5. **Give the `production` EAS environment an `EXPO_PUBLIC_API_URL`.** Check
   the current state first rather than trusting this page — it is EAS-side
   state, it changes without touching the repo, and this guide has already
   been wrong about it once:

   ```bash
   eas env:list --environment production   # expected today: no variables
   eas env:list --environment preview      # expected today: already set
   ```

   `preview` is already provisioned, so it needs no `eas env:create` — read
   the warning below about *what* it is set to. Only `production` is empty:

   ```bash
   eas env:create production --name EXPO_PUBLIC_API_URL --value https://<gateway-host>/graphql
   ```

   **The symptom if you skip this:** the build succeeds, installs, opens — and
   then throws on the *first* GraphQL call, every time. `client/.env` is
   gitignored (`client/.gitignore:36`) and EAS uploads only what git can see,
   so nothing from your machine reaches the builder. A standalone APK or AAB
   has no Expo host to derive a LAN address from either, so
   `client/src/services/endpoint.ts` takes its deliberate throw branch rather
   than guessing. `client/.env.example:4` already states the requirement.

   Do this while you are in the EAS console for step 4. Google sign-in needs
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, which is set in **no** environment
   today; it is optional, and its absence hides the sign-in button rather than
   breaking the app.

   > ⚠️ **`preview` currently points at a `trycloudflare.com` quick tunnel**,
   > and those hostnames are ephemeral — the URL dies when the tunnel
   > restarts. A `preview` build pinned to it works when you make it, then
   > starts failing every GraphQL call days later with a network error that
   > looks like a server outage, not a configuration mistake. Nothing warns
   > you, because the variable is still set and the build is still valid.
   > Replace it with a stable host as soon as one exists — for the same
   > reason, do not use a quick-tunnel URL for `production`.

After step 4, build a development client (`eas build --profile development
--platform android`) and install it on a real device. Push cannot be exercised
in Expo Go at all — Android dropped remote push in SDK 53 — so the dev build is
the prerequisite for testing this, and for any future Maestro or Detox run.

**That dev build will not catch a missing step 5.** A dev client gets its host
from Metro, so `development` is the one profile that works without an EAS
environment — which is exactly why the gap survives a green dev build and
surfaces later, in `preview`.

## What fails silently

### `google-services.json` in the native folder is ignored by git

```text
client/google-services.json              ✅ correct home — tracked by git
client/android/app/google-services.json  ❌ silently ignored (client/.gitignore:47 → /android)
```

The second path is where native Android instinct puts it, and it is wrong
here. Git ignores it without a word: your local build works, CI and every
fresh clone lack the file, and you get exactly the failure this document
exists to prevent. What makes the trap convincing is that `client/android/`
is a fully populated directory on disk with a real Gradle project in it —
nothing about looking at it suggests git is not watching.

The absence of the file does at least fail loudly at build time: `expo
prebuild` errors when `googleServicesFile` points at a missing path, so no
extra guard is needed. It is the *misplaced* copy that is dangerous, not the
missing one.

### If `client/android/` ever gets committed again, push silently stops working

**This was a live defect and is now fixed.** It is documented because
`expo prebuild` regenerates `client/android/` locally, so the folder is always
sitting there in your working tree, and a single `git add -A` can re-track it.
It cost a debugging session once; the point of this section is that it should
not cost a second.

**What the state was.** `client/.gitignore:47` ignores `/android`, but 52 files
under `client/android/` had been committed anyway — upgrade residue, not
intent. (The commit that removed `MainApplication.kt` and `MainActivity.kt`
from the index was an SDK-upgrade commit titled `preupgrade`, which is why the
tracked set was incomplete and could not have built on its own.)

**Why that silently broke push.** `eas-cli`'s `resolveWorkflowAsync`
(`build/project/workflow.js`) checks whether `android/app/build.gradle` and
`android/app/src/main/AndroidManifest.xml` exist **and are git-ignored**. Git
never reports a *tracked* file as ignored, so both markers came back "not
ignored" and the project resolved to `Workflow.GENERIC` — bare, not managed.
EAS Build then runs Gradle on the uploaded folder and **does not prebuild**.

No prebuild means no config-plugin mods, which means `android.googleServicesFile`
in `app.json` is never applied and no `com.google.gms.google-services` Gradle
plugin is wired in. Every step in this document could be done correctly and
the build would still come back green and deliver nothing.

**What was done.** `git rm -r --cached client/android` — index only, all files
left intact on disk. The folder is now covered by the ignore rule that always
claimed to cover it, and EAS resolves managed.

**How to recognise it if it comes back.** Two commands, both from the repo
root, both fast:

```bash
# Must print 0. Anything else means the folder is tracked again.
git ls-files client/android | wc -l

# Must print the ignore rule for both. Silence means tracked — the bad state.
git check-ignore -v client/android/app/build.gradle \
                    client/android/app/src/main/AndroidManifest.xml
```

Healthy output for the second command is:

```text
client/.gitignore:47:/android    client/android/app/build.gradle
client/.gitignore:47:/android    client/android/app/src/main/AndroidManifest.xml
```

`npx expo-doctor` is the other tell, and it is the cheaper one to notice. In
the bad state it fails a check that does not mention push at all:

```text
✖ Check for app config fields that may not be synced in a non-CNG project
  This project contains native project folders but also has native configuration
  properties in app.json ... EAS Build will not sync the following properties:
  orientation, icon, scheme, userInterfaceStyle, ios, android, plugins.
```

That check passes today. If it starts failing again, this is why — and push
delivery is what breaks, however unrelated the wording sounds.

Independently of all that: a **local** `npx expo run:android` uses the on-disk
`android/` as-is. That copy has no Firebase wiring until it is regenerated, so
after placing `google-services.json` run `npx expo prebuild -p android --clean`
before building locally.

### `POST_NOTIFICATIONS` looks missing and is not

`client/android/app/src/main/AndroidManifest.xml` does not list
`android.permission.POST_NOTIFICATIONS`, and the `expo-notifications` config
plugin does not add it either — `plugin/build/withNotificationsAndroid.js`
(v57.0.7) only does icon color, icon rasterization, manifest `meta-data`, and
sound copying. Checking either of those two files gives a **false negative**.

The permission actually arrives through Gradle manifest merge, from the
library's own manifest at
`client/node_modules/expo-notifications/android/src/main/AndroidManifest.xml:3`.
Merging happens at Gradle build time, which is after prebuild, so the
generated `client/android/` will never show it either. The runtime request
path is real (`NotificationPermissionsModule.kt:23`).

`app.json` now lists the permission explicitly anyway. It is redundant, and
that is deliberate: `android.permissions` had exactly one entry (`CAMERA`) and
read like an exhaustive inventory of what the app asks for, which is the same
false negative in a third place. Listing it costs nothing — Android manifest
merge is idempotent for an identical `uses-permission` declaration.

## Build profiles

`client/eas.json` was generated by `eas build:configure`, then given explicit
Android build types and an `environment` on the two profiles that need one:

| Profile | Distribution | Android output | EAS environment | For |
| --- | --- | --- | --- | --- |
| `development` | internal | `apk` | none — host comes from Metro | Dev client — the prerequisite for testing push at all. No usable build exists; see below |
| `preview` | internal | `apk` | `preview` | Internal testing builds — **only once step 5 is done**; until then it builds and throws on every request |
| `production` | store | `app-bundle` | `production` | Play Store, `autoIncrement` on. Same step-5 dependency |

### Existing builds are all too old to use

Every build on EAS is **SDK 54**; the tree is on SDK 57. So none of them are
usable, whatever the inventory looks like when you read this — that conclusion
survives new builds being added, which the counts below do not. Check before
quoting them:

```bash
eas build:list --platform android --limit 50
```

As of this page's `updated` date that returns five Android builds, all SDK 54:
two `preview` (both finished, 2026-07-23) and three `development` — one
finished 2026-07-23, one finished 2026-05-23, and one **errored** 2026-05-23.
An errored build is not evidence a build exists.

`development` deliberately has no `environment`. A dev client resolves the
gateway host from the Metro server it connects to, so pointing it at an EAS
environment would imply a variable that does not need to exist.

`cli.appVersionSource` is `"remote"`, so **EAS owns `versionCode`**. The
`"versionCode": 1` still sitting in `client/app.json` is decorative — editing
it has no effect on a build. Leave it or remove it, but do not expect it to do
anything.

`cli.version` is pinned to `>= 19.0.8`, the EAS CLI version this was generated
and verified with.

## Related

- [API.md §5.5.1](../reference/API.md#551-push-notifications) — the mutations,
  and the four things that decide whether a send happens at all: critical only,
  caregivers only, not for a reading measured more than 6 hours ago, and at
  most one per patient per 15 minutes
- [CLIENT-caregiver.md §4](../project/CLIENT-caregiver.md) — the client-side
  work that remains (`C-001`)
- [TESTING-plan.md](../project/TESTING-plan.md) — why the dev build gates
  device testing
