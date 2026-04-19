import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AiService, AI_JOB_ANALYZE, AI_QUEUE } from './ai.service';
import { AnalysisJobPayload, FastApiAnalysisResponse } from './types/ai.types';
import { ConfigService } from '@nestjs/config';

@Processor(AI_QUEUE)
export class AiProcessor {
  private readonly logger = new Logger(AiProcessor.name);
  private readonly fastApiUrl: string;

  constructor(
    private readonly aiService: AiService,
    private readonly configService: ConfigService,
  ) {
    this.fastApiUrl = this.configService.getOrThrow<string>('FASTAPI_URL');
  }

  @Process(AI_JOB_ANALYZE)
  async handleAnalyze(job: Job<AnalysisJobPayload>): Promise<void> {
    const { jobId, imageUrl, userId } = job.data;
    this.logger.log(`Processing job ${jobId} — user ${userId}`);

    // Mark as processing
    await this.aiService.setJobState(jobId, { status: 'processing' });

    try {
      // Call FastAPI YOLO service
      const response = await fetch(`${this.fastApiUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, image_url: imageUrl }),
        signal: AbortSignal.timeout(55_000), // stay within Bull's 60s default
      });

      if (!response.ok) {
        throw new Error(`FastAPI responded with ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as FastApiAnalysisResponse;

      await this.aiService.setJobState(jobId, {
        status: 'done',
        result: {
          readings: data.readings
            ? {
                systolic: data.readings.systolic,
                diastolic: data.readings.diastolic,
                pulse: data.readings.pulse,
              }
            : null,
          confidence: data.confidence,
          roiImageUrl: data.roi_image_url,
          rawText: data.raw_text,
          status: data.status,
        },
      });

      this.logger.log(`Job ${jobId} done — confidence ${data.confidence}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${jobId} failed: ${message}`);

      await this.aiService.setJobState(jobId, {
        status: 'failed',
        error: message,
      });

      // Re-throw so Bull registers the attempt as failed and retries
      throw err;
    }
  }
}