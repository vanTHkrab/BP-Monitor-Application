/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { ClientProxy } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { Job } from 'bullmq';
import { AI_JOB_ANALYZE } from './ai.service';
import { AiProcessor } from './ai.process';
import { MetricsLogger } from './metrics-logger';
import type { AiServiceAnalysisMetrics, OcrEngine } from './types/ai.types';

function makeJob(data: unknown, name = AI_JOB_ANALYZE): Job {
  return { name, data } as unknown as Job;
}

function rawMetrics(engine: OcrEngine = 'crnn'): AiServiceAnalysisMetrics {
  return {
    engine,
    fetch_ms: 10,
    detect_ms: 32,
    ocr_ms: 28,
    validate_ms: 1,
    total_ms: 75,
    rss_before_mb: 240,
    rss_after_mb: 258,
    rss_delta_mb: 18,
    image_size_bytes: 123456,
  };
}

function makeProcessor(opts: {
  reply: unknown;
  metricsAppend?: jest.Mock;
}): {
  processor: AiProcessor;
  metricsLogger: { appendRow: jest.Mock };
  aiClient: { send: jest.Mock };
} {
  const aiClient = {
    send: jest.fn().mockReturnValue(
      opts.reply instanceof Error
        ? throwError(() => opts.reply)
        : of(opts.reply),
    ),
  };
  const metricsLogger = {
    appendRow: opts.metricsAppend ?? jest.fn().mockResolvedValue(undefined),
  };
  const processor = new AiProcessor(
    aiClient as unknown as ClientProxy,
    metricsLogger as unknown as MetricsLogger,
  );
  return { processor, metricsLogger, aiClient };
}

describe('AiProcessor', () => {
  const goodPayload = {
    jobId: 'job-1',
    userId: 'user-1',
    s3Key: 'users/user-1/bp/readings/2026-05/abc.jpg',
    imageUrl: 'https://example/img.jpg',
    mimeType: 'image/jpeg',
  };

  const goodReply = {
    systolic: 120,
    diastolic: 80,
    pulse: 72,
    confidence: 0.92,
    raw_text: 'sys=120 dia=80 pulse=72',
    roi_image_url: null,
    model_version: '2026-01-29',
    status: 'success',
    engine: 'crnn',
    metrics: rawMetrics('crnn'),
  };

  describe('parseAiResponse', () => {
    it('returns null engine for unknown name', () => {
      const { processor } = makeProcessor({ reply: goodReply });
      const data = (processor as any).parseAiResponse({
        ...goodReply,
        engine: 'easyocr',
      });
      expect(data.engine).toBeNull();
      expect(data.metrics).toBeNull();
    });

    it('returns null metrics when engine missing', () => {
      const { processor } = makeProcessor({ reply: goodReply });
      const data = (processor as any).parseAiResponse({
        ...goodReply,
        engine: null,
        metrics: rawMetrics('crnn'),
      });
      expect(data.metrics).toBeNull();
    });

    it('returns null metrics when a numeric field is missing', () => {
      const { processor } = makeProcessor({ reply: goodReply });
      const broken = { ...rawMetrics(), fetch_ms: 'oops' as unknown as number };
      const data = (processor as any).parseAiResponse({
        ...goodReply,
        metrics: broken,
      });
      expect(data.metrics).toBeNull();
    });

    it('parses engine and metrics when present and valid', () => {
      const { processor } = makeProcessor({ reply: goodReply });
      const data = (processor as any).parseAiResponse(goodReply);
      expect(data.engine).toBe('crnn');
      expect(data.metrics).toEqual(rawMetrics('crnn'));
    });
  });

  describe('parseJobPayload', () => {
    it('accepts a known ocrEngine', () => {
      const { processor } = makeProcessor({ reply: goodReply });
      const parsed = (processor as any).parseJobPayload({
        ...goodPayload,
        ocrEngine: 'ssocr',
      });
      expect(parsed.ocrEngine).toBe('ssocr');
    });

    it('drops unknown ocrEngine values silently', () => {
      const { processor } = makeProcessor({ reply: goodReply });
      const parsed = (processor as any).parseJobPayload({
        ...goodPayload,
        ocrEngine: 'easyocr',
      });
      expect(parsed.ocrEngine).toBeUndefined();
    });
  });

  describe('process', () => {
    it('forwards ocrEngine to ai-service when present', async () => {
      const { processor, aiClient } = makeProcessor({ reply: goodReply });
      await processor.process(
        makeJob({ ...goodPayload, ocrEngine: 'ssocr_cnn' }),
      );
      const [, sent] = aiClient.send.mock.calls[0];
      expect(sent.ocrEngine).toBe('ssocr_cnn');
    });

    it('omits ocrEngine from the wire when caller did not pass one', async () => {
      const { processor, aiClient } = makeProcessor({ reply: goodReply });
      await processor.process(makeJob(goodPayload));
      const [, sent] = aiClient.send.mock.calls[0];
      expect(sent).not.toHaveProperty('ocrEngine');
    });

    it('returns engine and metrics on the AnalysisResult', async () => {
      const { processor } = makeProcessor({ reply: goodReply });
      const result = await processor.process(makeJob(goodPayload));
      expect(result.engine).toBe('crnn');
      expect(result.metrics?.totalMs).toBe(75);
      expect(result.metrics?.rssDeltaMb).toBe(18);
    });

    it('calls metricsLogger.appendRow with the engine and metrics', async () => {
      const { processor, metricsLogger } = makeProcessor({ reply: goodReply });
      await processor.process(makeJob(goodPayload));
      // appendRow is fire-and-forget; flush the microtask queue so the
      // test sees the call before assertions.
      await new Promise((r) => setImmediate(r));
      expect(metricsLogger.appendRow).toHaveBeenCalledTimes(1);
      const row = metricsLogger.appendRow.mock.calls[0][0];
      expect(row.engine).toBe('crnn');
      expect(row.jobId).toBe('job-1');
      expect(row.result.systolic).toBe(120);
    });

    it('skips metricsLogger when ai-service reply has no engine/metrics', async () => {
      const replyWithoutMetrics = { ...goodReply, engine: undefined, metrics: undefined };
      const { processor, metricsLogger } = makeProcessor({
        reply: replyWithoutMetrics,
      });
      await processor.process(makeJob(goodPayload));
      await new Promise((r) => setImmediate(r));
      expect(metricsLogger.appendRow).not.toHaveBeenCalled();
    });

    it('does not fail the job when metricsLogger throws', async () => {
      const { processor } = makeProcessor({
        reply: goodReply,
        metricsAppend: jest.fn().mockRejectedValue(new Error('S3 down')),
      });
      await expect(processor.process(makeJob(goodPayload))).resolves.toMatchObject({
        engine: 'crnn',
      });
    });
  });
});
