/**
 * Backend BP-image analysis: upload, enqueue, poll.
 *
 * The gateway does not analyse the bytes it is handed — it hands an S3 key to
 * ai-service over Redis and answers a job id. So this is three round trips
 * pretending to be one call, and the shape of the whole capture flow follows
 * from that: the photo is on the server before any reading exists, which is
 * why `analyzeImage` returns the `imageId` for the caller to carry into
 * `createReading` (see `CreateReadingInput.imageId` — without it the drain
 * uploads the same photo a second time).
 *
 * The upload itself is `services/upload-image.ts`, unchanged: one presign
 * path, one place where the React Native Blob trap is contained.
 *
 * **Latency budget.** This is the async half of the app — a poll that takes
 * ten seconds is acceptable, a screen that blocks on it is not. The caller
 * keeps the photo and manual entry usable throughout; nothing here is on the
 * path to saving a reading.
 */
import { graphqlRequest } from '@/services/api';
import { mimeTypeForUri, uploadImageViaPresign } from '@/services/upload-image';

import type { AnalysisJob, AnalysisJobStatus, AnalysisResult, OcrEngine } from '../types';

/**
 * `engine` and `metrics` are nullable on the gateway: an older deploy returns
 * null and the debug UI hides itself rather than the query failing.
 */
const ANALYSIS_JOB_FRAGMENT = `
  fragment AnalysisJobFields on AnalysisJob {
    jobId
    status
    result {
      readings { systolic diastolic pulse }
      confidence
      roiImageUrl
      rawText
      status
      engine
      metrics {
        fetchMs
        detectMs
        ocrMs
        validateMs
        totalMs
        rssBeforeMb
        rssAfterMb
        rssDeltaMb
        imageSizeBytes
      }
    }
    error
  }
`;

const GQL_ANALYZE_BP_IMAGE = `
  ${ANALYSIS_JOB_FRAGMENT}
  mutation AnalyzeBPImage($input: AnalyzeBPImageInput!) {
    analyzeBPImage(input: $input) { ...AnalysisJobFields }
  }
`;

const GQL_ANALYSIS_JOB = `
  ${ANALYSIS_JOB_FRAGMENT}
  query PollAnalysisJob($jobId: String!) {
    analysisJob(jobId: $jobId) { ...AnalysisJobFields }
  }
`;

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 60_000;

export type AnalyzeOptions = {
  signal?: AbortSignal;
  /** Debug-screen override. Omitted entirely in production — see `OcrEngine`. */
  ocrEngine?: OcrEngine;
  onStatusChange?: (status: AnalysisJobStatus) => void;
};

export type AnalyzeImageOutcome = {
  job: AnalysisJob;
  result: AnalysisResult | null;
  /** Canonical URL of the uploaded photo. */
  uploadedUrl: string;
  /**
   * The `Image.id` the upload minted. Carry this into `createReading` or the
   * drain will upload the same bytes again.
   */
  uploadedImageId: number | null;
};

const abortError = (): Error => {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
};

/** Interruptible sleep — a cancelled analysis must not sit out its interval. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function pollUntilDone(jobId: string, options: AnalyzeOptions): Promise<AnalysisJob> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus: AnalysisJobStatus | null = null;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw abortError();

    const { analysisJob: job } = await graphqlRequest<{ analysisJob: AnalysisJob }>(
      GQL_ANALYSIS_JOB,
      { jobId },
      { signal: options.signal },
    );

    if (job.status !== lastStatus) {
      lastStatus = job.status;
      options.onStatusChange?.(job.status);
    }

    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new Error(job.error ?? 'การวิเคราะห์ไม่สำเร็จ');

    await wait(POLL_INTERVAL_MS, options.signal);
  }

  throw new Error(`การวิเคราะห์ใช้เวลานานเกิน ${POLL_TIMEOUT_MS / 1000} วินาที`);
}

/**
 * Upload a photo, enqueue analysis, and wait for the verdict.
 *
 * Rejects on transport failure or a failed job; the caller treats that as "no
 * prefill", never as "no reading" — the user can always type the numbers.
 */
export async function analyzeImage(
  imageUri: string,
  options: AnalyzeOptions = {},
): Promise<AnalyzeImageOutcome> {
  const uploaded = await uploadImageViaPresign({
    uri: imageUri,
    kind: 'BLOOD_PRESSURE_READING',
  });

  // The gateway validates `ocrEngine` with `@IsIn`, so a forwarded literal
  // null is a 400. Absent means "server default", which is what production
  // wants.
  const input: { s3Key: string; mimeType: string; ocrEngine?: OcrEngine } = {
    s3Key: uploaded.key,
    mimeType: mimeTypeForUri(imageUri),
  };
  if (options.ocrEngine) input.ocrEngine = options.ocrEngine;

  const { analyzeBPImage: enqueued } = await graphqlRequest<{ analyzeBPImage: AnalysisJob }>(
    GQL_ANALYZE_BP_IMAGE,
    { input },
    { signal: options.signal },
  );

  const job = enqueued.status === 'done' ? enqueued : await pollUntilDone(enqueued.jobId, options);

  return {
    job,
    result: job.result ?? null,
    uploadedUrl: uploaded.url,
    uploadedImageId: uploaded.imageId,
  };
}
