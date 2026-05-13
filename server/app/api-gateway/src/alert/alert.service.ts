import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertType } from './alert.types';

type AlertWithReading = {
  id: number;
  userId: string;
  bpReadingId: number;
  alertMessage: string;
  alertLevel: string;
  readAt: Date | null;
  createdAt: Date;
  reading?: {
    id: number;
    systolic: number;
    diastolic: number;
    pulse: number;
    status: string;
    measuredAt: Date;
    s3Key: string | null;
  };
};

@Injectable()
export class AlertService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    limit: number,
    offset: number,
    unreadOnly: boolean,
  ): Promise<AlertType[]> {
    const rows = await this.prisma.alert.findMany({
      where: {
        userId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        reading: {
          select: {
            id: true,
            systolic: true,
            diastolic: true,
            pulse: true,
            status: true,
            measuredAt: true,
            s3Key: true,
          },
        },
      },
    });

    return rows.map((alert) => this.toAlertType(alert));
  }

  async markRead(userId: string, id: number): Promise<boolean> {
    const result = await this.prisma.alert.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });

    return result.count > 0;
  }

  async markAllRead(userId: string): Promise<boolean> {
    await this.prisma.alert.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return true;
  }

  private toAlertType(alert: AlertWithReading): AlertType {
    return {
      id: alert.id,
      userId: alert.userId,
      bpReadingId: alert.bpReadingId,
      alertMessage: alert.alertMessage,
      alertLevel: alert.alertLevel,
      readAt: alert.readAt ?? undefined,
      createdAt: alert.createdAt,
      reading: alert.reading
        ? {
            id: alert.reading.id,
            systolic: alert.reading.systolic,
            diastolic: alert.reading.diastolic,
            pulse: alert.reading.pulse,
            status: alert.reading.status,
            measuredAt: alert.reading.measuredAt,
            s3Key: alert.reading.s3Key ?? undefined,
          }
        : undefined,
    };
  }
}
