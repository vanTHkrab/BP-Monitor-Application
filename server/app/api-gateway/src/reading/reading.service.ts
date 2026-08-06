import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AlertLevel, BpStatus } from '../prisma/generated/enums';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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

      await this.prisma.alert.createMany({
        data: links.map((link) => ({
          userId: link.caregiverId,
          bpReadingId: readingId,
          alertLevel,
          alertMessage: this.getCaregiverAlertMessage(
            data.status,
            data,
            patientName,
          ),
        })),
        // A reading is created once, so this is defensive rather than a live
        // path — but a partial retry must not double a caregiver's bell.
        skipDuplicates: true,
      });
    } catch {
      // Swallowed on purpose: the patient has been alerted, the reading is
      // saved, and a failed fan-out must not surface as a failed save.
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
