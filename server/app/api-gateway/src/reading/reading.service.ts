import { Injectable } from '@nestjs/common';
import { AlertLevel, BpStatus } from '../prisma/generated/enums';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReadingService {
  constructor(private readonly prisma: PrismaService) {}

  async listByUser(userId: string, limit: number, offset: number) {
    return this.prisma.bloodPressureReading.findMany({
      where: { userId },
      orderBy: { measuredAt: 'desc' },
      take: limit,
      skip: offset,
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
      s3Key?: string;
      notes?: string;
    },
  ) {
    if (data.clientId) {
      const existing = await this.prisma.bloodPressureReading.findUnique({
        where: { clientId: data.clientId },
      });

      if (existing && existing.userId === userId) {
        return existing;
      }
    }

    const reading = await this.prisma.bloodPressureReading.create({
      data: {
        userId,
        systolic: data.systolic,
        diastolic: data.diastolic,
        pulse: data.pulse,
        status: data.status as BpStatus,
        measuredAt: data.measuredAt,
        clientId: data.clientId || null,
        s3Key: data.s3Key || null,
        notes: data.notes || null,
      },
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
