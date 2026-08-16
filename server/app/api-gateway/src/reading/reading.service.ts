import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AlertLevel, BpStatus } from '../prisma/generated/enums';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RateLimitService } from '../redis/rate-limit.service';

/**
 * How old a reading may be and still be worth pushing about.
 *
 * Readings are captured offline-first: the app queues them in SQLite and
 * `lib/sync.ts` drains the queue one mutation at a time when connectivity
 * returns. A patient offline for three days therefore arrives as several
 * separate `createReading` calls in a burst, each of which used to fire its
 * own push — a caregiver woken up over readings taken days ago, which they
 * can do nothing about.
 *
 * Six hours covers "measured this morning, synced at lunch" while refusing
 * anything a caregiver could no longer act on. The number is a judgement, not
 * a clinical threshold; the thing worth preserving is that a push claiming
 * "ค่าความดันวิกฤต" must mean *now*, because that is how the recipient will
 * read it.
 *
 * The alert row is written either way. Nothing is hidden — only the
 * interruption is withheld.
 */
const CRITICAL_PUSH_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * At most one critical push per patient per window, across all their
 * caregivers.
 *
 * The staleness gate above does not cover a patient who was offline for
 * twenty minutes and took three readings in it: all three are fresh, and all
 * three would push. This is the guard for that, and for genuine deterioration
 * measured repeatedly — three pushes in five minutes tell a caregiver nothing
 * the first one did not, and the cost of learning to ignore them is that they
 * ignore the next one too.
 *
 * Keyed by patient rather than by caregiver: `notifyUsers` sends to every
 * linked caregiver in one call, so the decision is "should anyone be
 * interrupted about this patient again yet".
 */
const CRITICAL_PUSH_RULE = { window: 15 * 60, max: 1 } as const;

// Shape returned to the resolver. The `images` relation is included so
// the resolver can derive a signed s3Key without a second query, and
// `recordedBy` so caregiver attribution renders without an N+1 — Prisma
// batches each relation into one extra query per list, not per row.
const READING_INCLUDE = {
  images: { select: { s3Key: true } },
  recordedBy: { select: { id: true, firstname: true, lastname: true } },
} as const;

@Injectable()
export class ReadingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    // The project's one rate limiter, exported by the `@Global()` RedisModule.
    // Used here as a "have we interrupted about this patient recently" gate
    // rather than to refuse a request — same atomic INCR + PEXPIRE primitive,
    // and writing a second counter against REDIS_CLIENT is what AGENTS.md
    // exists to prevent.
    private readonly rateLimit: RateLimitService,
  ) {}

  async listByUser(userId: string, limit: number, offset: number) {
    return this.prisma.bloodPressureReading.findMany({
      where: { userId },
      orderBy: { measuredAt: 'desc' },
      take: limit,
      skip: offset,
      include: READING_INCLUDE,
    });
  }

  /**
   * Create a reading owned by `targetUserId`, entered by `actorId`.
   * The two differ only in the caregiver-on-behalf flow — the resolver
   * has already authorized the accepted caregiver link before calling.
   * Attribution rule: `recordedById` is set only when someone else
   * entered the reading; self-entries stay NULL by design.
   */
  async create(
    targetUserId: string,
    data: {
      systolic: number;
      diastolic: number;
      pulse: number;
      status: string;
      measuredAt: Date;
      clientId?: string;
      imageId?: number;
      notes?: string;
    },
    actorId: string,
  ) {
    if (data.clientId) {
      const existing = await this.prisma.bloodPressureReading.findUnique({
        where: { clientId: data.clientId },
        include: READING_INCLUDE,
      });

      if (existing && existing.userId === targetUserId) {
        return existing;
      }
    }

    if (data.imageId !== undefined) {
      // Validate ownership + availability before the create so we throw a
      // clean 400/409 instead of a raw Prisma unique-constraint error from
      // the @unique on Image.readingId. The Image row belongs to whoever
      // uploaded it — in the caregiver flow that's the actor, not the
      // patient the reading is created for.
      const image = await this.prisma.image.findUnique({
        where: { id: data.imageId },
        select: { userId: true, readingId: true },
      });
      if (!image || image.userId !== actorId) {
        throw new BadRequestException('imageId ไม่ถูกต้องหรือไม่ใช่ของคุณ');
      }
      if (image.readingId !== null) {
        throw new ConflictException('รูปนี้ถูกผูกกับการวัดอื่นแล้ว');
      }
    }

    // Prisma turns the nested `images.connect` into a single transaction:
    // create the reading, then UPDATE the Image row to point readingId at
    // the new id. The @unique on Image.readingId is the final guard against
    // a concurrent attach winning the race.
    const reading = await this.prisma.bloodPressureReading.create({
      data: {
        userId: targetUserId,
        recordedById: actorId === targetUserId ? null : actorId,
        systolic: data.systolic,
        diastolic: data.diastolic,
        pulse: data.pulse,
        status: data.status as BpStatus,
        measuredAt: data.measuredAt,
        clientId: data.clientId || null,
        notes: data.notes || null,
        ...(data.imageId !== undefined
          ? { images: { connect: { id: data.imageId } } }
          : {}),
      },
      include: READING_INCLUDE,
    });

    // The patient always gets one; their accepted caregivers get their own
    // copy. See `createAlertForReading`.
    await this.createAlertForReading(targetUserId, reading.id, {
      systolic: data.systolic,
      diastolic: data.diastolic,
      pulse: data.pulse,
      status: data.status,
      // Not `now`: an offline reading is created long after it was taken, and
      // whether a caregiver should be interrupted depends on when the
      // measurement happened, not on when the queue drained.
      measuredAt: data.measuredAt,
    });

    return reading;
  }

  async delete(userId: string, id: number) {
    const reading = await this.prisma.bloodPressureReading.findUnique({
      where: { id },
    });
    if (!reading || reading.userId !== userId) {
      return null;
    }
    return this.prisma.bloodPressureReading.delete({ where: { id } });
  }

  /**
   * Raises the alert for a reading — one row for the patient, plus one for
   * each caregiver with an accepted link to them.
   *
   * **Why a row per recipient rather than one shared row.** `readAt` lives on
   * the alert, so a shared row means shared read state: a caregiver marking
   * an alert read would mark it read for the patient too, hiding a critical
   * value from the person it is about. Duplicated rows cost storage; shared
   * read state costs correctness, and only one of those is recoverable.
   *
   * It is also what makes a caregiver's own notification bell work at all.
   * Before this, `Alert.userId` was only ever the patient, so the entire
   * premise of the role — somebody else is watching — had no passive path:
   * a caregiver learned nothing unless they opened the app and went looking.
   *
   * The caregiver's copy names the patient, because "ค่าความดันของคุณสูง"
   * arriving on someone else's phone is worse than no alert.
   *
   * Best-effort on the fan-out only: if the caregiver lookup or their inserts
   * fail, the patient's alert has already been written and the reading save
   * must not be rolled back for a notification.
   */
  private async createAlertForReading(
    patientId: string,
    readingId: number,
    data: {
      systolic: number;
      diastolic: number;
      pulse: number;
      status: string;
      measuredAt: Date;
    },
  ) {
    if (data.status === 'normal') {
      return;
    }

    const alertLevel: AlertLevel =
      data.status === 'critical' ? 'critical' : 'warning';

    await this.prisma.alert.create({
      data: {
        userId: patientId,
        bpReadingId: readingId,
        alertLevel,
        alertMessage: this.getAlertMessage(data.status, data),
      },
    });

    try {
      const links = await this.prisma.caregiverPatient.findMany({
        where: { patientId, status: 'accepted' },
        select: { caregiverId: true },
      });
      if (links.length === 0) return;

      const patient = await this.prisma.user.findUnique({
        where: { id: patientId },
        select: { firstname: true, lastname: true },
      });
      const patientName =
        `${patient?.firstname ?? ''} ${patient?.lastname ?? ''}`.trim() ||
        'ผู้ป่วยที่คุณดูแล';

      const caregiverMessage = this.getCaregiverAlertMessage(
        data.status,
        data,
        patientName,
      );

      await this.prisma.alert.createMany({
        data: links.map((link) => ({
          userId: link.caregiverId,
          bpReadingId: readingId,
          alertLevel,
          alertMessage: caregiverMessage,
        })),
        // A reading is created once, so this is defensive rather than a live
        // path — but a partial retry must not double a caregiver's bell.
        skipDuplicates: true,
      });

      // Push is `critical` only, while the rows above are written for
      // `warning` too. Deliberate: somebody with chronic hypertension
      // produces several warning-level readings a day, and a caregiver who
      // gets pushed for each of them turns notifications off — after which
      // they receive nothing, including the one reading that mattered.
      // Alert fatigue is the failure mode being designed against here, so
      // widening this to `warning` is not an improvement; it is the bug.
      //
      // Caregivers only. The patient is holding the phone that just took the
      // measurement and has already seen the number, so pushing to them is
      // noise — the fan-out writes them a row, but never a push.
      //
      // Fire-and-forget: an outbound HTTPS call to Expo must not sit inside
      // the reading mutation's latency budget, and `notifyUsers` never
      // rejects, for the same reason this whole block is wrapped in a catch.
      if (
        data.status === 'critical' &&
        (await this.shouldInterruptCaregivers(patientId, data.measuredAt))
      ) {
        void this.push
          .notifyUsers(
            links.map((link) => link.caregiverId),
            {
              title: 'ค่าความดันวิกฤต',
              body: caregiverMessage,
              data: {
                type: 'bp-critical',
                bpReadingId: readingId,
                patientId,
                alertLevel,
              },
            },
          )
          .catch(() => {
            // `notifyUsers` is documented never to reject; this is the belt to
            // that brace. Because the call is deliberately not awaited, a
            // rejection would surface as an unhandled rejection and take the
            // process down under Node's default policy — strictly worse than a
            // missed push.
          });
      }
    } catch {
      // Swallowed on purpose: the patient has been alerted, the reading is
      // saved, and a failed fan-out must not surface as a failed save.
    }
  }

  /**
   * Whether a critical reading has earned an interruption, as opposed to a
   * row in a list.
   *
   * Two gates, and the **order is load-bearing**. Staleness is checked first
   * because it costs nothing and, more importantly, because a stale reading
   * must not spend the burst budget: draining a three-day backlog would
   * otherwise consume the window and silence a genuinely live reading that
   * synced moments later, which is the one this whole path exists for.
   *
   * Fails **open**. `RateLimitService` already degrades to a per-process
   * counter when Redis is unready, and any unexpected error here resolves to
   * "yes, push". A missed critical alert is worse than a duplicate one, so
   * the failure direction is deliberate — this is a filter on noise, never a
   * gate on safety.
   */
  private async shouldInterruptCaregivers(
    patientId: string,
    measuredAt: Date,
  ): Promise<boolean> {
    const age = Date.now() - measuredAt.getTime();

    // A future `measuredAt` is a clock-skewed device, not a reason to refuse:
    // a negative age passes, and the burst gate below still applies.
    if (age > CRITICAL_PUSH_MAX_AGE_MS) return false;

    try {
      const decision = await this.rateLimit.consume(
        `push:critical:${patientId}`,
        CRITICAL_PUSH_RULE,
      );
      return decision.allowed;
    } catch {
      return true;
    }
  }

  /**
   * The caregiver-facing wording. Leads with the patient's name — the
   * recipient's first question is *who*, not *what*.
   */
  private getCaregiverAlertMessage(
    status: string,
    data: { systolic: number; diastolic: number; pulse: number },
    patientName: string,
  ) {
    const valueText = `${data.systolic}/${data.diastolic} mmHg ชีพจร ${data.pulse} bpm`;

    switch (status) {
      case 'low':
        return `คุณ${patientName} มีค่าความดันค่อนข้างต่ำ (${valueText})`;
      case 'elevated':
        return `คุณ${patientName} มีค่าความดันเริ่มสูง (${valueText})`;
      case 'high':
        return `คุณ${patientName} มีค่าความดันสูง (${valueText}) ควรติดตามอาการ`;
      case 'critical':
        return `คุณ${patientName} มีค่าความดันสูงมาก (${valueText}) หากมีอาการผิดปกติควรพบแพทย์หรือโทร 1669`;
      default:
        return `คุณ${patientName} มีผลการวัดใหม่ (${valueText})`;
    }
  }

  private getAlertMessage(
    status: string,
    data: { systolic: number; diastolic: number; pulse: number },
  ) {
    const valueText = `${data.systolic}/${data.diastolic} mmHg ชีพจร ${data.pulse} bpm`;

    switch (status) {
      case 'low':
        return `ค่าความดันค่อนข้างต่ำ (${valueText}) ควรพัก ดื่มน้ำ และสังเกตอาการ`;
      case 'elevated':
        return `ค่าความดันเริ่มสูง (${valueText}) ควรพัก 5-10 นาทีแล้ววัดซ้ำ`;
      case 'high':
        return `ค่าความดันสูง (${valueText}) ควรหลีกเลี่ยงกิจกรรมหนักและติดตามอาการ`;
      case 'critical':
        return `ค่าความดันสูงมาก (${valueText}) หากมีอาการผิดปกติควรพบแพทย์หรือโทร 1669`;
      default:
        return `มีผลการวัดใหม่ (${valueText})`;
    }
  }
}
