/**
 * What a `bp-critical` push payload means. Pure, so the decision is testable
 * without a notification, a router, or a network.
 *
 * The shape is written by the gateway in
 * `server/app/api-gateway/src/reading/reading.service.ts` —
 * `{ type: 'bp-critical', bpReadingId, patientId, alertLevel }` — and is a
 * wire contract in the same sense the Redis channels are: nothing type-checks
 * it across the boundary, so this side validates rather than casts.
 *
 * `bpReadingId` arrives as a number because the gateway's `Alert.bpReadingId`
 * is an `Int`, but Expo's transport round-trips `data` through JSON and both
 * platforms have been observed to hand it back as a string. Both are accepted
 * and normalised, because the alternative is a payload that silently fails to
 * parse on one OS.
 */

/** Stamped by the gateway on every critical-reading push. */
export const CRITICAL_ALERT_TYPE = 'bp-critical';

export type CriticalAlertPayload = {
  /** The patient whose reading it was — the subject the app must switch to. */
  patientId: string;
  /** The `Alert.bpReadingId` the notification is about. */
  bpReadingId: number | null;
  alertLevel: string | null;
};

function asId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Returns `null` for anything that is not a critical-BP push, including this
 * app's own local notifications — the reminder and invite payloads carry
 * `kind`, not `type`, so the two vocabularies cannot collide.
 *
 * `patientId` is the only required field. Without it the app cannot tell whose
 * data to show, and showing the wrong person's is the failure this whole path
 * is arranged to prevent; `bpReadingId` and `alertLevel` are context and the
 * tap is still worth honouring without them.
 */
export function parseCriticalAlert(data: unknown): CriticalAlertPayload | null {
  if (!data || typeof data !== 'object') return null;

  const value = data as Record<string, unknown>;
  if (value.type !== CRITICAL_ALERT_TYPE) return null;

  const patientId = typeof value.patientId === 'string' ? value.patientId.trim() : '';
  if (!patientId) return null;

  return {
    patientId,
    bpReadingId: asId(value.bpReadingId),
    alertLevel: typeof value.alertLevel === 'string' ? value.alertLevel : null,
  };
}
