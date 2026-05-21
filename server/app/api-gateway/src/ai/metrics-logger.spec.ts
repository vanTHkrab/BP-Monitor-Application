/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Readable } from 'node:stream';
import { S3StorageClient } from '../storage/s3-storage.client';
import { MetricsLogger, type MetricsRow } from './metrics-logger';

function row(overrides: Partial<MetricsRow> = {}): MetricsRow {
  return {
    ts: '2026-05-21T12:34:56.789Z',
    jobId: 'job-1',
    userId: 'user-1',
    engine: 'crnn',
    imageSizeBytes: 12345,
    result: {
      systolic: 120,
      diastolic: 80,
      pulse: 72,
      confidence: 0.92,
      status: 'success',
    },
    metrics: {
      engine: 'crnn',
      fetch_ms: 10,
      detect_ms: 32,
      ocr_ms: 28,
      validate_ms: 1,
      total_ms: 75,
      rss_before_mb: 240,
      rss_after_mb: 258,
      rss_delta_mb: 18,
      image_size_bytes: 12345,
    },
    modelVersion: '2026-01-29',
    ...overrides,
  };
}

function streamFor(content: string): Readable {
  return Readable.from([Buffer.from(content, 'utf8')]);
}

describe('MetricsLogger', () => {
  let s3: {
    head: jest.Mock;
    get: jest.Mock;
    put: jest.Mock;
  };
  let logger: MetricsLogger;

  beforeEach(() => {
    s3 = {
      head: jest.fn(),
      get: jest.fn(),
      put: jest.fn().mockResolvedValue({ key: 'ok', bucket: 'b' }),
    };
    logger = new MetricsLogger(s3 as unknown as S3StorageClient);
  });

  it('writes a single-line file when the daily key does not exist', async () => {
    s3.head.mockResolvedValue(null);
    await logger.appendRow(row());
    expect(s3.get).not.toHaveBeenCalled();
    expect(s3.put).toHaveBeenCalledTimes(1);
    const putCall = s3.put.mock.calls[0][0];
    expect(putCall.key).toBe('metrics/ocr-comparison/2026-05-21.jsonl');
    const body = putCall.body as Buffer;
    const text = body.toString('utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text.trimEnd()).jobId).toBe('job-1');
  });

  it('appends to the existing day file with one row per JSONL line', async () => {
    s3.head.mockResolvedValue({ contentLength: 100, contentType: 'application/x-ndjson' });
    const existing = `${JSON.stringify(row({ jobId: 'job-0' }))}\n`;
    s3.get.mockResolvedValue({ body: streamFor(existing), contentType: 'application/x-ndjson' });

    await logger.appendRow(row({ jobId: 'job-1' }));
    const putBody = (s3.put.mock.calls[0][0].body as Buffer).toString('utf8');
    const lines = putBody.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).jobId).toBe('job-0');
    expect(JSON.parse(lines[1]).jobId).toBe('job-1');
  });

  it('keys files by the UTC date of the row timestamp', async () => {
    s3.head.mockResolvedValue(null);
    // 23:30 UTC and the next minute UTC: same date file
    await logger.appendRow(row({ ts: '2026-05-21T23:30:00Z' }));
    expect(s3.put.mock.calls[0][0].key).toBe(
      'metrics/ocr-comparison/2026-05-21.jsonl',
    );

    // 00:30 UTC the next day: new file
    s3.put.mockClear();
    await logger.appendRow(row({ ts: '2026-05-22T00:30:00Z' }));
    expect(s3.put.mock.calls[0][0].key).toBe(
      'metrics/ocr-comparison/2026-05-22.jsonl',
    );
  });

  it('propagates errors from the underlying S3 client', async () => {
    s3.head.mockResolvedValue(null);
    s3.put.mockRejectedValue(new Error('S3 quota exceeded'));
    await expect(logger.appendRow(row())).rejects.toThrow('S3 quota exceeded');
  });
});
