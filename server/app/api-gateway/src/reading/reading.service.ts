import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AlertLevel, BpStatus } from '../prisma/generated/enums';
import { PrismaService } from '../prisma/prisma.service';

// Shape returned to the resolver. The `images` relation is included so
// the resolver can derive a signed s3Key without a second query.
const READING_WITH_IMAGE = {
  images: { select: { s3Key: true } },
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
      include: READING_WITH_IMAGE,
    });
  }

  async create(
    userId: string,
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
  ) {
    if (data.clientId) {
      const existing = await this.prisma.bloodPressureReading.findUnique({
        where: { clientId: data.clientId },
        include: READING_WITH_IMAGE,
      });

      if (existing && existing.userId === userId) {
        return existing;
      }
    }

    if (data.imageId !== undefined) {
      // Validate ownership + availability before the create so we throw a
      // clean 400/409 instead of a raw Prisma unique-constraint error from
      // the @unique on Image.readingId.
      const image = await this.prisma.image.findUnique({
        where: { id: data.imageId },
        select: { userId: true, readingId: true },
      });
      if (!image || image.userId !== userId) {
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
        userId,
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
      include: READING_WITH_IMAGE,
    });

    await this.createAlertForReading(userId, reading.id, {
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

  private async createAlertForReading(
    userId: string,
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
    const alertMessage = this.getAlertMessage(data.status, data);

    await this.prisma.alert.create({
      data: {
        userId,
        bpReadingId: readingId,
        alertLevel,
        alertMessage,
      },
    });
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
