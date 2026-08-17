/**
 * Blood-pressure classification, and the words and colour that go with it.
 *
 * Ported from `client-old/constants/colors.ts`. The thresholds are unchanged;
 * what moved is where they live. They were sitting in a file named for the
 * colour palette, next to hex values, which is why the palette port
 * (`theme/tokens.js`) left them behind.
 *
 * **The client is not the authority, and no longer pretends to be.** This used
 * to decide what got persisted: `CreateReadingInput.status` was sent by the
 * client and stored verbatim. The gateway now re-derives it from the numbers
 * in `server/app/api-gateway/src/reading/bp-status.ts` and stores its own
 * answer, so what is sent from here is a hint. A disagreement is corrected
 * silently — never rejected, because a reading queued offline by an older
 * build has to be able to sync — and logged server-side.
 *
 * What this function is still for is the moment before any of that: offline,
 * at the instant of measurement, the patient has to be told what 190/125
 * means without waiting for a network. The mirror then takes the server's
 * value (`toMirrorRow` reads `created.status`), so a drifted classification
 * self-corrects on sync.
 *
 * **The window that does not self-correct is the one that matters most:** the
 * colour and words on screen between measuring and syncing. Keep the ladder
 * below in step with the gateway's copy — treat them as a pair, the way
 * `capture/lib/detection.ts` and `analyzer/yolo.py` are treated.
 *
 * Rendering trusts the stored value; only a *new* reading is classified here.
 */
import { status as statusColor } from '@/theme';
import type { BPStatus } from '../types';

/**
 * The ladder, in the order it is evaluated. Systolic **or** diastolic
 * crossing a bound is enough — an isolated diastolic of 95 is hypertension
 * whatever the systolic says, and taking the milder of the two would tell a
 * patient they are fine.
 */
export const BP_THRESHOLDS = {
  low: { systolic: 90, diastolic: 60 },
  elevated: { systolic: 130, diastolic: 85 },
  high: { systolic: 140, diastolic: 90 },
  critical: { systolic: 180, diastolic: 120 },
} as const;

export function classifyReading(systolic: number, diastolic: number): BPStatus {
  // Low is checked first, and before the high bands: a systolic of 85 with a
  // diastolic of 95 is a reading to question, not one to file as
  // hypertension. Ordering it after `high` would silently pick the scarier
  // half of a pair that probably means the cuff slipped.
  if (systolic < BP_THRESHOLDS.low.systolic || diastolic < BP_THRESHOLDS.low.diastolic) {
    return 'low';
  }
  if (
    systolic >= BP_THRESHOLDS.critical.systolic ||
    diastolic >= BP_THRESHOLDS.critical.diastolic
  ) {
    return 'critical';
  }
  if (systolic >= BP_THRESHOLDS.high.systolic || diastolic >= BP_THRESHOLDS.high.diastolic) {
    return 'high';
  }
  if (
    systolic >= BP_THRESHOLDS.elevated.systolic ||
    diastolic >= BP_THRESHOLDS.elevated.diastolic
  ) {
    return 'elevated';
  }
  return 'normal';
}

const LABELS: Record<BPStatus, string> = {
  low: 'ความดันต่ำ',
  normal: 'ปกติ',
  elevated: 'ค่อนข้างสูง',
  high: 'ความดันสูง',
  critical: 'ความดันสูงมาก',
};

/**
 * One line of what to do about it.
 *
 * Deliberately not medical advice and deliberately not alarming: the reading
 * that most needs acting on is the one whose owner is already frightened, and
 * copy that escalates gets ignored the third time it appears. `critical` is
 * the only one that names an action with a deadline.
 */
const GUIDANCE: Record<BPStatus, string> = {
  low: 'ลองนั่งพักแล้ววัดซ้ำอีกครั้ง หากมีอาการหน้ามืดหรือใจสั่นควรปรึกษาแพทย์',
  normal: 'ค่าอยู่ในเกณฑ์ปกติ วัดสม่ำเสมอต่อไปเพื่อดูแนวโน้ม',
  elevated: 'สูงกว่าเกณฑ์เล็กน้อย ลองพักสัก 5 นาทีแล้ววัดซ้ำ และสังเกตค่าในสัปดาห์นี้',
  high: 'ค่าอยู่ในเกณฑ์ความดันสูง ควรวัดซ้ำและปรึกษาแพทย์หากยังสูงต่อเนื่อง',
  critical: 'ค่าสูงมาก หากมีอาการปวดศีรษะ เจ็บหน้าอก หรือตาพร่า ให้พบแพทย์ทันที',
} as const;

/** `theme/tokens.js` owns the hex; the ladder is mode-independent by design. */
const COLORS: Record<BPStatus, string> = {
  low: statusColor.low,
  normal: statusColor.normal,
  elevated: statusColor.elevated,
  high: statusColor.high,
  critical: statusColor.critical,
};

/**
 * Every status, derived from `LABELS` rather than written out again. `LABELS`
 * is a `Record<BPStatus, string>`, so the compiler forces a new member into it
 * — which makes this list the one place that cannot drift from the type. The
 * severity filter's partition test asserts against it for exactly that reason:
 * a sixth status added to `BPStatus` fails a test instead of quietly landing
 * in no filter group.
 */
export const BP_STATUSES = Object.keys(LABELS) as BPStatus[];

/** Narrows a stored string. An unrecognised value renders as `normal` rather
 *  than crashing a list — but it is never *written* by this build. */
export function parseStatus(value: string | null | undefined): BPStatus {
  return BP_STATUSES.includes(value as BPStatus) ? (value as BPStatus) : 'normal';
}

export const statusLabel = (status: BPStatus): string => LABELS[status];
export const statusGuidance = (status: BPStatus): string => GUIDANCE[status];
export const statusColorFor = (status: BPStatus): string => COLORS[status];
