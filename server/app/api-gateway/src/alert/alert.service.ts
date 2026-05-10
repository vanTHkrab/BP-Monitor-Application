import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertType } from './alert.types';

type AlertWithAnalysis = {
  id: number;
  userId: string;
  analysisId: number;
  alertMessage: string;
  alertLevel: string;
  isRead: boolean;
  createdAt: Date;
  analysis?: {
    id: number;
    systolic: number;
    diastolic: number;
    pulseRate: number;
    confidenceScore: number;
    bpLevel: string;
    analysisNote: string | null;
    analyzedAt: Date;
    image?: { imageUrl: string } | null;
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
        analysis: {
          include: {
            image: { select: { imageUrl: true } },
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

  private toAlertType(alert: AlertWithAnalysis): AlertType {
    return {
      id: alert.id,
      userId: alert.userId,
      analysisId: alert.analysisId,
      alertMessage: alert.alertMessage,
      alertLevel: alert.alertLevel,
      isRead: alert.isRead,
      createdAt: alert.createdAt,
      analysis: alert.analysis
        ? {
            id: alert.analysis.id,
            systolic: alert.analysis.systolic,
            diastolic: alert.analysis.diastolic,
            pulse: alert.analysis.pulseRate,
            confidence: alert.analysis.confidenceScore,
            bpLevel: alert.analysis.bpLevel,
            analysisNote: alert.analysis.analysisNote ?? undefined,
            analyzedAt: alert.analysis.analyzedAt,
            imageUrl: alert.analysis.image?.imageUrl ?? undefined,
          }
        : undefined,
    };
  }
}
