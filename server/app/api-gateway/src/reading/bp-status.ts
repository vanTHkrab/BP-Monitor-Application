import { BpStatus } from '../prisma/generated/enums';

/**
 * Blood-pressure classification, server-side.
 *
 * ## Why this exists here as well as on the client
 *
 * `CreateReadingInput.status` arrives from the app, and `@IsEnum(BpStatus)`
 * only asks whether it is a word the enum knows — never whether it matches the
 * numbers beside it. Both of these used to be stored verbatim:
 *
 * ```text
 * { systolic: 120, diastolic: 80,  status: 'critical' }  -> alerts + a push
 * { systolic: 200, diastolic: 130, status: 'normal'   }  -> silence
 * ```
 *
 * The stored value drives the alert level, whether caregivers are interrupted,
 * the colour on every screen, the history filters, and the export. Leaving the
 * decision with the caller made all of that a client-side contract, and the
 * realistic way it breaks needs no bad actor: an older build that still holds
 * the previous thresholds keeps sending its own verdict, and nothing anywhere
 * reports the disagreement.
 *
 * The app cannot stop classifying — it is offline-first, and a patient who has
 * just measured 190/125 has to be told so before there is any network to ask.
 * So this is a second copy on purpose, and it is the authoritative one.
 *
 * ## Keep it in step with the client
 *
 * The ladder mirrors `client/src/modules/readings/lib/status.ts`. Changing one
 * side alone does not corrupt stored data any more — the server overwrites, so
 * its answer is what persists — but it does mean the patient sees one verdict
 * at the moment of measurement and a different one once the reading syncs.
 * That window is exactly when a critical reading matters most, so treat the
 * two tables as a pair, the way `capture/lib/detection.ts` and
 * `analyzer/yolo.py` are treated.
 */

/**
 * The bounds, in the order the ladder evaluates them. Systolic **or**
 * diastolic crossing a bound is enough: an isolated diastolic of 95 is
 * hypertension whatever the systolic says, and taking the milder of the two
 * would tell a patient they are fine.
 */
export const BP_THRESHOLDS = {
  low: { systolic: 90, diastolic: 60 },
  elevated: { systolic: 130, diastolic: 85 },
  high: { systolic: 140, diastolic: 90 },
  critical: { systolic: 180, diastolic: 120 },
} as const;

/**
 * The reading's true status, derived from the numbers alone.
 *
 * **The order of these branches is load-bearing, not stylistic.** `low` is
 * tested before the high bands: a systolic of 85 with a diastolic of 95 is a
 * reading to question — a cuff that slipped, an arm at the wrong height — not
 * one to file as hypertension. Moving `low` after `high` silently picks the
 * scarier half of a pair that probably means the measurement went wrong, and
 * it changes the answer for exactly the crossed readings nobody thinks to
 * test.
 */
export function classifyReading(systolic: number, diastolic: number): BpStatus {
  if (
    systolic < BP_THRESHOLDS.low.systolic ||
    diastolic < BP_THRESHOLDS.low.diastolic
  ) {
    return BpStatus.low;
  }
  if (
    systolic >= BP_THRESHOLDS.critical.systolic ||
    diastolic >= BP_THRESHOLDS.critical.diastolic
  ) {
    return BpStatus.critical;
  }
  if (
    systolic >= BP_THRESHOLDS.high.systolic ||
    diastolic >= BP_THRESHOLDS.high.diastolic
  ) {
    return BpStatus.high;
  }
  if (
    systolic >= BP_THRESHOLDS.elevated.systolic ||
    diastolic >= BP_THRESHOLDS.elevated.diastolic
  ) {
    return BpStatus.elevated;
  }
  return BpStatus.normal;
}
