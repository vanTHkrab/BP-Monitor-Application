import { Injectable, Logger } from '@nestjs/common';
import { S3StorageClient } from '../storage/s3-storage.client';
import type {
  AiServiceAnalysisMetrics,
  BPReadingStatus,
  OcrEngine,
} from './types/ai.types';

// One JSONL row per analysis — appended to a daily file on S3 so the
// M2.2 comparison phase can run offline analysis with the standard
// jq / DuckDB tools instead of building a real analytics surface.
// Field naming mirrors ai-service's snake_case wire shape so a row
// reads the same on both sides of the contract.
export interface MetricsRow {
  ts: string; // ISO 8601 UTC
  jobId: string;
  userId: string;
  engine: OcrEngine;
  imageSizeBytes: number;
  result: {
    systolic: number | null;
    diastolic: number | null;
    pulse: number | null;
    confidence: number;
    status: BPReadingStatus;
  };
  metrics: AiServiceAnalysisMetrics | null;
  modelVersion: string | null;
}

const PREFIX = 'metrics/ocr-comparison';

/**
 * Append-style JSONL writer backed by S3.
 *
 * S3 has no native append, so we get-and-rewrite the day's file per
 * row: read existing bytes (or empty if 404) → append the new line →
 * PUT back with same key. This is acceptable for M2.2's low throughput
 * (dev-only opt-in clients + occasional production samples); if traffic
 * climbs or two workers race, switch to one file per analysis or to
 * Kinesis Firehose. Keep the seam narrow — only one method is exported
 * on the public surface.
 *
 * Failures bubble up as exceptions so the caller can decide whether to
 * swallow (the AiProcessor does — telemetry must never block analysis).
 */
@Injectable()
export class MetricsLogger {
  private readonly logger = new Logger(MetricsLogger.name);

  constructor(private readonly s3: S3StorageClient) {}

  async appendRow(row: MetricsRow): Promise<void> {
    const key = this.keyForDate(new Date(row.ts));
    const line = `${JSON.stringify(row)}\n`;
    const existing = await this.readExisting(key);
    const body = existing
      ? Buffer.concat([existing, Buffer.from(line, 'utf8')])
      : Buffer.from(line, 'utf8');
    await this.s3.put({
      key,
      body,
      contentType: 'application/x-ndjson',
    });
    this.logger.debug(
      `Appended metrics row jobId=${row.jobId} engine=${row.engine} key=${key}`,
    );
  }

  /**
   * Computes the daily key from the row timestamp. UTC date keeps files
   * stable regardless of which timezone a worker runs in.
   */
  private keyForDate(date: Date): string {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${PREFIX}/${yyyy}-${mm}-${dd}.jsonl`;
  }

  private async readExisting(key: string): Promise<Buffer | null> {
    const existing = await this.s3.head(key);
    if (!existing) return null;
    const { body } = await this.s3.get(key);
    const chunks: Buffer[] = [];
    // Node's `Readable` async iterator types each chunk as `any`. The S3
    // SDK actually yields `Buffer` (or `string` if an encoding is set
    // upstream), so narrow explicitly. Without the cast,
    // `@typescript-eslint/no-unsafe-argument` warns on the Buffer.from call.
    for await (const chunk of body as AsyncIterable<Buffer | string>) {
      chunks.push(
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
      );
    }
    return Buffer.concat(chunks);
  }
}
