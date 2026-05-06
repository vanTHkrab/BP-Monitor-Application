import { Injectable } from '@nestjs/common';
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
      imageUri?: string;
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
        status: data.status as any,
        measuredAt: data.measuredAt,
        clientId: data.clientId || null,
        imageUri: data.imageUri || null,
        notes: data.notes || null,
      },
    });

    await this.createManualAnalysisAndAlert(userId, {
      systolic: data.systolic,
      diastolic: data.diastolic,
      pulse: data.pulse,
      status: data.status,
      imageUri: data.imageUri,
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

  private async createManualAnalysisAndAlert(
    userId: string,
    data: {
      systolic: number;
      diastolic: number;
      pulse: number;
      status: string;
      imageUri?: string;
    },
  ) {
    if (!data.imageUri) {
      return;
    }

    let image = await this.prisma.image.findFirst({
      where: {
        userId,
        imageUrl: data.imageUri,
      },
      include: { analysisResult: true },
    });

    if (!image) {
      image = await this.prisma.image.create({
        data: {
          userId,
          imageUrl: data.imageUri,
          deviceName: 'manual-entry',
          syncStatus: 'synced',
          syncedAt: new Date(),
        },
        include: { analysisResult: true },
      });
    }

    if (image.analysisResult) {
      return;
    }

    const bpLevel =
      data.status === 'elevated'
        ? 'elevated'
        : data.status === 'high' || data.status === 'critical'
          ? 'highRisk'
          : 'normal';

    const analysis = await this.prisma.analysisResult.create({
      data: {
        imageId: image.id,
        systolic: data.systolic,
        diastolic: data.diastolic,
        pulseRate: data.pulse,
        confidenceScore: 1,
        bpLevel: bpLevel as any,
        analysisNote:
          'Manual entry: บันทึกค่าด้วยผู้ใช้ระหว่างรอโมเดล OCR/ROI ทำงานจริง',
      },
    });

    if (data.status === 'normal') {
      return;
    }

    const alertLevel = data.status === 'critical' ? 'critical' : 'warning';
    const alertMessage = this.getAlertMessage(data.status, data);

    await this.prisma.alert.create({
      data: {
        userId,
        analysisId: analysis.id,
        alertLevel: alertLevel as any,
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
