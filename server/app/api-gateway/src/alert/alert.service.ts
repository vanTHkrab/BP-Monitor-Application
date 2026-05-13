import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertType } from './alert.types';

type AlertWithReading = {
  id: number;
  userId: string;
  bpReadingId: number;
  alertMessage: string;
  alertLevel: string;
  isRead: boolean;
  createdAt: Date;
  reading?: {
    id: number;
    systolic: number;
    diastolic: number;
    pulse: number;
    status: string;
    measuredAt: Date;
    imageUri: string | null;
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
        ...(unreadOnly ? { isRead: false } : {}),
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
            imageUri: true,
          },
        },
      },
    });

    return rows.map((alert) => this.toAlertType(alert));
  }

  async markRead(userId: string, id: number): Promise<boolean> {
    const result = await this.prisma.alert.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });

    return result.count > 0;
  }

  async markAllRead(userId: string): Promise<boolean> {
    await this.prisma.alert.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
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
      isRead: alert.isRead,
      createdAt: alert.createdAt,
      reading: alert.reading
        ? {
            id: alert.reading.id,
            systolic: alert.reading.systolic,
            diastolic: alert.reading.diastolic,
            pulse: alert.reading.pulse,
            status: alert.reading.status,
            measuredAt: alert.reading.measuredAt,
            imageUri: alert.reading.imageUri ?? undefined,
          }
        : undefined,
    };
  }
}
