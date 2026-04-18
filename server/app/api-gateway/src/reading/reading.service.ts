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
    return this.prisma.bloodPressureReading.create({
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
}
