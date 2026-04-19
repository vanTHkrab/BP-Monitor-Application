/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Job } from 'bullmq';
import { firstValueFrom, timeout } from 'rxjs';
import { AI_JOB_ANALYZE, AI_QUEUE } from './ai.service';
import {
  AiServiceAnalysisResponse,
  AnalysisJobPayload,
  AnalysisResult,
  BPReadingStatus,
} from './types/ai.types';

@Processor(AI_QUEUE)
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(@Inject('AI_SERVICE') private readonly aiClient: ClientProxy) {
    super();
  }

  // BullMQ stores this return value on the job, which the resolver reads while polling.
  async process(job: Job): Promise<AnalysisResult> {
    if (job.name !== AI_JOB_ANALYZE) {
      throw new Error(`Unsupported AI job type: ${job.name}`);
    }

    const payload = this.parseJobPayload(job.data as unknown);
    const { jobId, userId, filename, mimetype, imageBase64 } = payload;
    this.logger.log(`Processing job ${jobId} for user ${userId}`);

    try {
      const response = await firstValueFrom(
        this.aiClient
          .send<unknown>('analyze_bp_image', {
            jobId,
            userId,
            filename,
            mimetype,
            imageBase64,
          })
          .pipe(timeout(55_000)),
      );

      const data = this.parseAiResponse(response);

      if (data.error) {
        throw new Error(data.error);
      }

      const readings =
        Number.isFinite(data.systolic) &&
        Number.isFinite(data.diastolic) &&
        Number.isFinite(data.pulse)
          ? {
              systolic: data.systolic,
              diastolic: data.diastolic,
              pulse: data.pulse,
            }
          : null;

      const confidence = Number.isFinite(data.confidence) ? data.confidence : 0;

      const result: AnalysisResult = {
        readings,
        confidence,
        roiImageUrl: data.roi_image_url ?? null,
        rawText: data.raw_text ?? null,
        status: this.toAnalysisStatus(readings, confidence),
      };

      this.logger.log(`Job ${jobId} done with confidence ${confidence}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${jobId} failed: ${message}`);
      throw err;
    }
  }

  private toAnalysisStatus(
    readings: AnalysisResult['readings'],
    confidence: number,
  ): BPReadingStatus {
    if (!readings) {
      return 'unreadable';
    }

    if (confidence < 0.75) {
      return 'low_confidence';
    }

    return 'success';
  }

  private parseAiResponse(value: unknown): AiServiceAnalysisResponse {
    if (!value || typeof value !== 'object') {
      throw new Error('AI service returned an invalid response payload');
    }

    const payload = value as Record<string, unknown>;

    return {
      confidence:
        typeof payload.confidence === 'number' ? payload.confidence : 0,
      systolic:
        typeof payload.systolic === 'number' ? payload.systolic : Number.NaN,
      diastolic:
        typeof payload.diastolic === 'number' ? payload.diastolic : Number.NaN,
      pulse: typeof payload.pulse === 'number' ? payload.pulse : Number.NaN,
      roi_image_url:
        typeof payload.roi_image_url === 'string'
          ? payload.roi_image_url
          : null,
      raw_text: typeof payload.raw_text === 'string' ? payload.raw_text : null,
      error: typeof payload.error === 'string' ? payload.error : undefined,
    };
  }

  private parseJobPayload(value: unknown): AnalysisJobPayload {
    if (!value || typeof value !== 'object') {
      throw new Error('AI queue payload is invalid');
    }

    const payload = value as Record<string, unknown>;
    const jobId = payload.jobId;
    const userId = payload.userId;
    const filename = payload.filename;
    const mimetype = payload.mimetype;
    const imageBase64 = payload.imageBase64;

    if (
      typeof jobId !== 'string' ||
      typeof userId !== 'string' ||
      typeof filename !== 'string' ||
      typeof mimetype !== 'string' ||
      typeof imageBase64 !== 'string'
    ) {
      throw new Error('AI queue payload is missing required fields');
    }

    return {
      jobId,
      userId,
      filename,
      mimetype,
      imageBase64,
    };
  }
}
