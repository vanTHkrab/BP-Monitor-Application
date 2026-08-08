# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

Ships from one Expo/React Native codebase to both iOS and Android with the
same NativeWind design language (not per-OS adaptive) — `android/` is
committed and treated as the source of truth for native config; `ios/` is
gitignored and regenerated on demand. Android is the primary target.

## Users

Two roles, chosen once during post-signup onboarding and not editable from
any current surface:

- **Patient** — self-monitors blood pressure at home, often elderly.
  Readability and simplicity are load-bearing, not cosmetic.
- **Caregiver** — a family member or clinician who reviews BP readings for
  patients who have accepted a caregiver link. Caregiver reach comes from
  an accepted `CaregiverPatient` relationship per patient, not from the
  role itself.

A web dashboard (`web/`) exists for clinicians/caregivers reviewing data,
separate from this mobile app.

## Product Purpose

Blood-pressure monitoring that works the way people actually take a
reading at home: point the phone's camera at the BP monitor's display, let
on-device or backend OCR read the numbers, and keep working even with no
connectivity. Manual entry is always the fallback, never the only path
being designed for.

## Positioning

Not a manual BP-log form. The mechanism a competing "log your BP" app
could not casually copy: camera capture → YOLO ROI detection → CRNN digit
recognition, running the *same* model on-device (Android, via the native
`bp-vision` Kotlin module) and on the backend (`ai-service`), with a live
on-screen framing gate that coaches the user into a readable shot before
they even press the shutter. Offline-first end to end — a reading taken
with no signal queues locally and syncs once reconnected, rather than
failing or being lost.

## Operating Context

- Home self-monitoring: patient points their phone at a physical BP
  monitor's LCD/LED display, most often alone, sometimes assisted by a
  caregiver in the room.
  patient uses to log a reading.
- Caregivers review remotely, asynchronously, from either the mobile app
  or the web dashboard — not present at capture time.
- Connectivity is not assumed. Rural/home wifi dead zones and monitors
  used indoors are the normal case, not the edge case.

## Capabilities and Constraints

- **Thai-language UI.** All user-facing copy is Thai; developer-facing
  content (code, docs, commit messages) stays English per the root
  `CLAUDE.md`.
- **Elderly-first readability.** ~11px is the enforced floor for body
  text; `usePreferencesStore().fontSize` (small/medium/large/xlarge) plus
  `useTypography()` is the live mechanism — a redesign must keep scaling
  through it, not hardcode literal sizes that ignore the preference.
  `medium` is the default rung, not the smallest. The same store also holds
  `fontFamily` (Noto Sans Thai / looped / Sarabun), and the resolver enforces
  a per-family Thai line-height floor so below-baseline vowels are not clipped.
- **Offline-first architecture.** SQLite mirrors both the pending-write
  queue and confirmed data; Postgres via the gateway is the durable source
  of truth. UI must never assume a network round-trip completes
  synchronously.
- **Role is fixed post-onboarding.** No "change role" surface exists yet;
  don't design one into this pass.
- **Mobile only**, Expo Router file-based navigation, NativeWind for
  styling. Not a native-per-OS design language — one visual system across
  iOS and Android.

## Product Principles

1. **Readable before beautiful.** The elderly-first floor and the font
   scale preference are non-negotiable inputs to any visual decision, not
   defaults to override for density.
2. **Offline is not a degraded mode.** Screens must read as intentional
   when data is queued/syncing, not broken.
3. **Two roles, one shell, split only where it actually diverges.** Shared
   surfaces (settings) stay shared; role-specific route groups exist only
   once a screen's content genuinely differs by role.
4. **Thai-first copy**, direct and specific — no invented English
   marketing tone in translation.

## Accessibility & Inclusion

Elderly-first is the primary accessibility axis this product designs for:
minimum readable text size, room for a font-size preference to actually
move the needle on real screens, and high-contrast status color use for
BP-range indicators (`status.normal` / `elevated` / `high` / `low` in
`client/src/theme/tokens.js`).
