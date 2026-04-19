import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { AnalysisJobObject } from './dto/analysis-job.object';
import { SubmitBPReadingInput } from './dto/submit-bp-reading.input';
import { AnalysisJobPayload, AnalysisJobStatus, AnalysisResult } from './types/ai.types';
import { BpReading } from '../readings/entities/bp-reading.entity';
import { StorageService } from '../storage/storage.service';

export const AI_QUEUE = 'ai-analysis';
export const AI_JOB_ANALYZE = 'analyze-bp-image';

// Redis key helpers
const jobKey = (jobId: string) => `ai:job:${jobId}`;
const TTL_SECONDS = 60 * 60; // 1 hour

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectQueue(AI_QUEUE) private readonly aiQueue: Queue,
    @InjectRepository(BpReading) private readonly readingRepo: Repository<BpReading>,
    private readonly storageService: StorageService,
  ) {}

  // ─── Upload & enqueue ──────────────────────────────────────────────────────

  async enqueueImageAnalysis(
    file: { buffer: Buffer; mimetype: string; originalname: string },
    userId: string,
  ): Promise<AnalysisJobObject> {
    // 1. Upload image to object storage (S3 / GCS / MinIO)
    const imageUrl = await this.storageService.uploadBuffer({
      buffer: file.buffer,
      mimetype: file.mimetype,
      folder: 'bp-images',
      filename: `${userId}_${Date.now()}_${file.originalname}`,
    });

    // 2. Create job record in Redis
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const initialJob: AnalysisJobObject = { jobId, status: 'pending', result: null };
    await this.setJobState(jobId, initialJob);

    // 3. Push to Bull queue → processor picks up → calls FastAPI
    const payload: AnalysisJobPayload = { jobId, imageUrl, userId };
    await this.aiQueue.add(AI_JOB_ANALYZE, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.log(`Enqueued analysis job ${jobId} for user ${userId}`);
    return initialJob;
  }

  // ─── Poll job state ────────────────────────────────────────────────────────

  async getJobState(jobId: string): Promise<AnalysisJobObject> {
    const raw = await this.aiQueue.client.get(jobKey(jobId));
    if (!raw) throw new NotFoundException(`Job ${jobId} not found`);
    return JSON.parse(raw) as AnalysisJobObject;
  }

  // ─── Called by processor ──────────────────────────────────────────────────

  async setJobState(jobId: string, state: Partial<AnalysisJobObject>): Promise<void> {
    const existing = await this.aiQueue.client
      .get(jobKey(jobId))
      .then((r) => (r ? (JSON.parse(r) as AnalysisJobObject) : null))
      .catch(() => null);

    const merged: AnalysisJobObject = { ...existing, ...state, jobId };
    await this.aiQueue.client.setex(jobKey(jobId), TTL_SECONDS, JSON.stringify(merged));
  }

  // ─── Persist confirmed reading ─────────────────────────────────────────────

  async submitReading(input: SubmitBPReadingInput, userId: string): Promise<BpReading> {
    // Resolve imageUrl — jobId may point to an already-uploaded image
    let imageUrl: string | null = null;
    try {
      const job = await this.getJobState(input.jobId);
      // Pull imageUrl from result if available, else re-upload from imageUri
      imageUrl = job.result?.roiImageUrl ?? null;
    } catch {
      // manual entry without AI — imageUri is the local path, upload it
    }

    if (!imageUrl && input.imageUri) {
      imageUrl = await this.storageService.uploadFromUri(input.imageUri, userId);
    }

    const reading = this.readingRepo.create({
      userId,
      systolic: input.systolic,
      diastolic: input.diastolic,
      pulse: input.pulse,
      measuredAt: new Date(input.measuredAt),
      imageUrl,
      jobId: input.jobId,
    });

    return this.readingRepo.save(reading);
  }
}