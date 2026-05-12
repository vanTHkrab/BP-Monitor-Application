import { InjectQueue } from '@nestjs/bullmq';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { BpStatus } from '../prisma/generated/enums';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageClient } from '../storage/s3-storage.client';
import {
  ImageKind,
  buildFinalKey,
  isFinalKeyOwnedBy,
} from '../storage/types/storage.types';
import { AnalysisJobObject } from './dto/analysis-job.object';
import { SubmitBPReadingInput } from './dto/submit-bp-reading.input';
import { AnalysisJobPayload, AnalysisResult } from './types/ai.types';

export const AI_QUEUE = 'ai-analysis';
export const AI_JOB_ANALYZE = 'analyze-bp-image';

const RETAIN_COMPLETED_SECONDS = 60 * 60; // 1 hour
const RETAIN_FAILED_SECONDS = 24 * 60 * 60; // 24 hours

// Keep thresholds in sync with client status labeling to avoid mismatched badges.
function toBpStatus(systolic: number, diastolic: number): BpStatus {
  if (systolic < 90 || diastolic < 60) {
    return 'low';
  }
  if (systolic >= 180 || diastolic >= 120) {
    return 'critical';
  }
  if (systolic >= 140 || diastolic >= 90) {
    return 'high';
  }
  if (systolic >= 130 || diastolic >= 85) {
    return 'elevated';
  }
  return 'normal';
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectQueue(AI_QUEUE)
    private readonly aiQueue: Queue<AnalysisJobPayload, AnalysisResult>,
    private readonly prisma: PrismaService,
    private readonly s3: S3StorageClient,
  ) {}

  /**
   * Enqueue analysis for an image already present in S3 (presigned flow).
   * The caller must have run requestImageUpload + confirmImageUpload before
   * calling this; the key is verified to belong to the user.
   */
  async enqueueFromKey(
    s3Key: string,
    mimeType: string,
    userId: string,
  ): Promise<AnalysisJobObject> {
    this.assertBPKeyOwnedBy(userId, s3Key);
    return this.enqueue({ jobId: randomUUID(), userId, s3Key, mimeType });
  }

  /**
   * Legacy multipart path: gateway received the image bytes, uploads them
   * to S3 first, then enqueues the resulting key. Kept as a compatibility
   * shim for mobile builds still on the multipart mutation.
   */
  async enqueueFromBuffer(
    file: { buffer: Buffer; mimetype: string; originalname: string },
    userId: string,
  ): Promise<AnalysisJobObject> {
    const s3Key = buildFinalKey(
      ImageKind.BLOOD_PRESSURE_READING,
      userId,
      randomUUID(),
      file.mimetype,
    );

    await this.s3.put({
      key: s3Key,
      body: file.buffer,
      contentType: file.mimetype,
      metadata: { userId, kind: ImageKind.BLOOD_PRESSURE_READING },
    });

    return this.enqueue({
      jobId: randomUUID(),
      userId,
      s3Key,
      mimeType: file.mimetype,
    });
  }

  private async enqueue(
    payload: AnalysisJobPayload,
  ): Promise<AnalysisJobObject> {
    await this.aiQueue.add(AI_JOB_ANALYZE, payload, {
      jobId: payload.jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: RETAIN_COMPLETED_SECONDS },
      removeOnFail: { age: RETAIN_FAILED_SECONDS },
    });

    this.logger.log(
      `Enqueued analysis job ${payload.jobId} userId=${payload.userId} s3Key=${payload.s3Key}`,
    );
    return {
      jobId: payload.jobId,
      status: 'pending',
      result: null,
      error: null,
    };
  }

  private assertBPKeyOwnedBy(userId: string, s3Key: string): void {
    if (!isFinalKeyOwnedBy(ImageKind.BLOOD_PRESSURE_READING, userId, s3Key)) {
      throw new ForbiddenException('S3 key นี้ไม่ใช่ของคุณ');
    }
  }

  async getJobState(jobId: string, userId: string): Promise<AnalysisJobObject> {
    const job = await this.getOwnedJob(jobId, userId);
    const state = await job.getState();

    if (state === 'completed') {
      return {
        jobId,
        status: 'done',
        result: this.asAnalysisResult(job.returnvalue),
        error: null,
      };
    }

    if (state === 'failed') {
      return {
        jobId,
        status: 'failed',
        result: null,
        error: job.failedReason ?? 'Analysis failed',
      };
    }

    if (state === 'active') {
      return {
        jobId,
        status: 'processing',
        result: null,
        error: null,
      };
    }

    return {
      jobId,
      status: 'pending',
      result: null,
      error: null,
    };
  }

  async submitReading(
    input: SubmitBPReadingInput,
    userId: string,
  ): Promise<{
    id: number;
    systolic: number;
    diastolic: number;
    pulse: number;
    measuredAt: Date;
    imageUri: string | null;
  }> {
    let fallbackImageUri: string | null = null;

    if (input.jobId) {
      const job = await this.getOwnedJob(input.jobId, userId);
      const state = await job.getState();
      if (state === 'completed') {
        fallbackImageUri =
          this.asAnalysisResult(job.returnvalue)?.roiImageUrl ?? null;
      }
    }

    const reading = await this.prisma.bloodPressureReading.create({
      data: {
        userId,
        systolic: input.systolic,
        diastolic: input.diastolic,
        pulse: input.pulse,
        measuredAt: new Date(input.measuredAt),
        status: toBpStatus(input.systolic, input.diastolic),
        imageUri: input.imageUri ?? fallbackImageUri,
      },
    });

    return {
      id: reading.id,
      systolic: reading.systolic,
      diastolic: reading.diastolic,
      pulse: reading.pulse,
      measuredAt: reading.measuredAt,
      imageUri: reading.imageUri,
    };
  }

  private async getOwnedJob(
    jobId: string,
    userId: string,
  ): Promise<Job<AnalysisJobPayload, AnalysisResult>> {
    const job = await this.aiQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    // Prevent users from polling or submitting against another user's job ID.
    if (job.data.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this analysis job',
      );
    }

    return job;
  }

  private asAnalysisResult(value: unknown): AnalysisResult | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const parsed = value as Partial<AnalysisResult>;
    const status = parsed.status;
    const confidence = parsed.confidence;

    if (
      (status !== 'success' &&
        status !== 'low_confidence' &&
        status !== 'unreadable') ||
      typeof confidence !== 'number'
    ) {
      return null;
    }

    const readings = parsed.readings;
    const normalizedReadings =
      readings &&
      typeof readings.systolic === 'number' &&
      typeof readings.diastolic === 'number' &&
      typeof readings.pulse === 'number'
        ? {
            systolic: readings.systolic,
            diastolic: readings.diastolic,
            pulse: readings.pulse,
          }
        : null;

    return {
      readings: normalizedReadings,
      confidence,
      roiImageUrl: parsed.roiImageUrl ?? null,
      rawText: parsed.rawText ?? null,
      status,
    };
  }
}
