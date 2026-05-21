import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Job } from 'bullmq';
import { firstValueFrom, timeout } from 'rxjs';
import { AI_JOB_ANALYZE, AI_QUEUE } from './ai.service';
import { MetricsLogger } from './metrics-logger';
import {
  AiServiceAnalysisMetrics,
  AiServiceAnalysisResponse,
  AnalysisJobPayload,
  AnalysisMetrics,
  AnalysisResult,
  BPReadingStatus,
  OCR_ENGINES,
  OcrEngine,
} from './types/ai.types';

@Processor(AI_QUEUE)
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(
    @Inject('AI_SERVICE') private readonly aiClient: ClientProxy,
    private readonly metricsLogger: MetricsLogger,
  ) {
    super();
  }

  // BullMQ stores this return value on the job, which the resolver reads while polling.
  async process(job: Job): Promise<AnalysisResult> {
    if (job.name !== AI_JOB_ANALYZE) {
      throw new Error(`Unsupported AI job type: ${job.name}`);
    }

    const payload = this.parseJobPayload(job.data as unknown);
    const { jobId, userId, s3Key, imageUrl, mimeType, ocrEngine } = payload;
    this.logger.log(
      `Processing job ${jobId} for user ${userId} s3Key=${s3Key} engine=${ocrEngine ?? '(default)'}`,
    );

    try {
      const response = await firstValueFrom(
        this.aiClient
          .send<unknown>('analyze_bp_image', {
            jobId,
            userId,
            s3Key,
            imageUrl,
            mimeType,
            // Only include ``ocrEngine`` when explicitly set so production
            // traffic preserves the "field absent → server default" semantic.
            ...(ocrEngine ? { ocrEngine } : {}),
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

      const metrics = data.metrics
        ? this.toAnalysisMetrics(data.metrics)
        : null;

      const result: AnalysisResult = {
        readings,
        confidence,
        roiImageUrl: data.roi_image_url ?? null,
        rawText: data.raw_text ?? null,
        // Trust ai-service's status when it sends one (the real pipeline
        // applies cross-field rules like sys > dia that the gateway can't
        // re-derive from confidence alone). Fall back to local derivation
        // for backward compatibility with payloads that omit the field.
        status: data.status ?? this.toAnalysisStatus(readings, confidence),
        modelVersion: data.model_version ?? null,
        engine: data.engine ?? null,
        metrics,
      };

      // Fire-and-forget JSONL append. Telemetry must never block the
      // user-facing path or fail the BullMQ job — a missed row is
      // strictly worse than blocking analysis, so we swallow.
      if (data.engine && metrics) {
        this.metricsLogger
          .appendRow({
            ts: new Date().toISOString(),
            jobId,
            userId,
            engine: data.engine,
            imageSizeBytes: metrics.imageSizeBytes,
            result: {
              systolic: readings?.systolic ?? null,
              diastolic: readings?.diastolic ?? null,
              pulse: readings?.pulse ?? null,
              confidence,
              status: result.status,
            },
            metrics: data.metrics ?? null,
            modelVersion: result.modelVersion,
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Metrics logger append failed jobId=${jobId}: ${msg}`,
            );
          });
      }

      this.logger.log(
        `Job ${jobId} done engine=${data.engine ?? '(unknown)'} confidence=${confidence}`,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${jobId} failed: ${message}`);
      throw err;
    }
  }

  private toAnalysisMetrics(
    raw: AiServiceAnalysisMetrics,
  ): AnalysisMetrics {
    return {
      fetchMs: raw.fetch_ms,
      detectMs: raw.detect_ms,
      ocrMs: raw.ocr_ms,
      validateMs: raw.validate_ms,
      totalMs: raw.total_ms,
      rssBeforeMb: raw.rss_before_mb,
      rssAfterMb: raw.rss_after_mb,
      rssDeltaMb: raw.rss_delta_mb,
      imageSizeBytes: raw.image_size_bytes,
    };
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
    const status = this.parseStatus(payload.status);
    const engine = this.parseEngine(payload.engine);
    const metrics = this.parseMetrics(payload.metrics, engine);

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
      model_version:
        typeof payload.model_version === 'string'
          ? payload.model_version
          : null,
      status,
      engine,
      metrics,
      error: typeof payload.error === 'string' ? payload.error : undefined,
    };
  }

  private parseStatus(value: unknown): BPReadingStatus | undefined {
    if (
      value === 'success' ||
      value === 'low_confidence' ||
      value === 'unreadable'
    ) {
      return value;
    }
    return undefined;
  }

  private parseEngine(value: unknown): OcrEngine | null {
    if (typeof value !== 'string') return null;
    return (OCR_ENGINES as readonly string[]).includes(value)
      ? (value as OcrEngine)
      : null;
  }

  /**
   * ``metrics`` is a flat dict on the wire. We accept it when every required
   * numeric field is present and finite; partial / malformed metrics are
   * dropped so the result still surfaces without bogus telemetry rows.
   * ``engine`` from the parsed payload backfills the metrics object's
   * own engine field — they're produced together by ai-service.
   */
  private parseMetrics(
    value: unknown,
    engine: OcrEngine | null,
  ): AiServiceAnalysisMetrics | null {
    if (!value || typeof value !== 'object' || !engine) return null;
    const m = value as Record<string, unknown>;
    const numericKeys = [
      'fetch_ms',
      'detect_ms',
      'ocr_ms',
      'validate_ms',
      'total_ms',
      'rss_before_mb',
      'rss_after_mb',
      'rss_delta_mb',
      'image_size_bytes',
    ] as const;
    for (const key of numericKeys) {
      if (typeof m[key] !== 'number' || !Number.isFinite(m[key])) return null;
    }
    return {
      engine,
      fetch_ms: m.fetch_ms as number,
      detect_ms: m.detect_ms as number,
      ocr_ms: m.ocr_ms as number,
      validate_ms: m.validate_ms as number,
      total_ms: m.total_ms as number,
      rss_before_mb: m.rss_before_mb as number,
      rss_after_mb: m.rss_after_mb as number,
      rss_delta_mb: m.rss_delta_mb as number,
      image_size_bytes: m.image_size_bytes as number,
    };
  }

  private parseJobPayload(value: unknown): AnalysisJobPayload {
    if (!value || typeof value !== 'object') {
      throw new Error('AI queue payload is invalid');
    }

    const payload = value as Record<string, unknown>;
    const { jobId, userId, s3Key, imageUrl, mimeType, ocrEngine } = payload;

    if (
      typeof jobId !== 'string' ||
      typeof userId !== 'string' ||
      typeof s3Key !== 'string' ||
      typeof imageUrl !== 'string' ||
      typeof mimeType !== 'string'
    ) {
      throw new Error('AI queue payload is missing required fields');
    }

    const parsed: AnalysisJobPayload = { jobId, userId, s3Key, imageUrl, mimeType };
    if (
      typeof ocrEngine === 'string' &&
      (OCR_ENGINES as readonly string[]).includes(ocrEngine)
    ) {
      parsed.ocrEngine = ocrEngine as OcrEngine;
    }
    return parsed;
  }
}
