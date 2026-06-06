# Product

## Register

product

## Users

**Primary (in scope for this critique):** Thai patients managing blood pressure
on their phone. Mostly older adults (50+), often glasses-wearing, sometimes
distracted, occasionally with shaky hands or low fine-motor control. Context:
home, at the kitchen table, right after a reading on a physical BP monitor;
also in the car as a passenger; also in clinic waiting rooms. They use the app
to capture the monitor screen, log readings, browse history, and share with a
caregiver. They are not technical and will not read instructions.

**Secondary (not in scope here, but on the roadmap):** Caregivers viewing a
patient's history on the same mobile app, and clinicians plus the dev team on
the web dashboard. The web dashboard ships in dual mode: clinician-facing
patient view and engineering infra view.

## Product Purpose

Capture, store, and review blood-pressure readings reliably, including the
hours when the network is unavailable. The mobile app must let a patient log a
reading in under 15 seconds (camera path or manual entry), keep the record
visible even after reinstall, and never lose a reading silently. Success looks
like a patient confidently checking and logging readings every day without
calling a younger relative for help.

## Brand Personality

Friendly, encouraging, warm. Three words: **caring, steady, plain-spoken**.
Voice in Thai is informal but respectful (uses softening particles where
appropriate); voice in dev-facing English is direct. The app should feel
closer to a thoughtful family member than to a hospital chart. Color and
typography lean warm without being saccharine; encouragement comes from copy
and from reading-state feedback, not from confetti.

## Anti-references

- **1990s Thai-hospital / clinic forms.** Dense grey tables, narrow form
  fields, dropdown soup, lecturing tone. The app must not feel like filling
  out paperwork at the OPD.
- **Apple Health / Samsung Health lifestyle aesthetic.** Big gradient rings,
  motivational metrics, "you crushed today" tone. This is a medical tracking
  tool for people with diagnosed hypertension, not a fitness app.
- **Default shadcn / SaaS-template greyscale.** All-neutral OKLCH chroma-0
  palettes with no identity. The web project currently lives there; the
  mobile app must not absorb it.
- **Terminal / dev-tool dark-mode-only.** Older users in bright Thai daylight
  need a light theme that holds up; dark is an option, not a personality.

## Design Principles

1. **Defaults beat options.** Older users will not tune settings. The first
   path through every screen must be the right one for the typical patient,
   not a power-user surface.
2. **Latency budgets are asymmetric.** Logging a reading must feel instant
   (optimistic UI, offline-safe). AI analysis is allowed to be async and to
   show progress; manual entry never waits on a network.
3. **Warm, not loud.** Encouragement is in the copy and the colour of a
   successful save, not in animation choreography. No bouncing icons, no
   confetti, no celebration screens.
4. **Show, do not lecture.** State feedback (saved, syncing, failed, queued)
   beats explanatory text. If the UI needs a paragraph to explain a screen,
   the screen is wrong.
5. **Pre-flight is warn, never block.** On-device YOLO can be wrong; the user
   always has a "ส่งต่อไป" path forward. The model is a hint, not a gate.

## Accessibility & Inclusion

- **WCAG AA at minimum** for contrast on the mobile light theme (≥4.5:1 for
  body, ≥3:1 for large text). Dark theme held to the same bar.
- **Hit targets ≥44pt** for any tap target the patient must reach during a
  one-handed log; primary actions live in the bottom thumb zone.
- **Honour `reduce-motion`** OS setting; subtle transitions become instant.
- **Font scale tied to `fontSizePreference`** in the store, not to the OS-only
  setting, so users who have not figured out the system setting still benefit.
- **Thai is the user-facing language**; English in the UI only where it is a
  proper noun (e.g. brand or unit "mmHg"). Sentences in ALL CAPS are banned
  outright in Thai body copy; they read as shouting and most Thai fonts have
  no real uppercase form.
