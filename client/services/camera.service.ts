import { gqlRequest, gqlUpload } from '@/lib/graphql-client';
import type { AnalysisJob, AnalysisResult, SubmitReadingPayload, UploadImagePayload } from '@/types';

// ─── Fragments ────────────────────────────────────────────────────────────────

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
    }
    error
  }
`;

// ─── Operations ───────────────────────────────────────────────────────────────

const UPLOAD_BP_IMAGE_MUTATION = `
  ${ANALYSIS_JOB_FRAGMENT}
  mutation UploadBPImage($file: Upload!) {
    uploadBPImage(file: $file) { ...AnalysisJobFields }
  }
`;

const POLL_ANALYSIS_JOB_QUERY = `
  ${ANALYSIS_JOB_FRAGMENT}
  query PollAnalysisJob($jobId: String!) {
    analysisJob(jobId: $jobId) { ...AnalysisJobFields }
  }
`;

const SUBMIT_BP_READING_MUTATION = `
  mutation SubmitBPReading($input: SubmitBPReadingInput!) {
    submitBPReading(input: $input) {
      id systolic diastolic pulse measuredAt imageUrl
    }
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uriToMime(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', heic: 'image/heic', webp: 'image/webp',
  };
  return map[ext] ?? 'image/jpeg';
}

function uriToFilename(uri: string): string {
  return uri.split('/').pop() ?? `bp_${Date.now()}.jpg`;
}

// ─── Polling ──────────────────────────────────────────────────────────────────

interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStatusChange?: (status: AnalysisJob['status']) => void;
}

async function pollUntilDone(jobId: string, options: PollOptions = {}): Promise<AnalysisJob> {
  const { intervalMs = 1500, timeoutMs = 60_000, signal, onStatusChange } = options;
  const deadline = Date.now() + timeoutMs;
  let lastStatus: AnalysisJob['status'] | null = null;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const data = await gqlRequest<{ analysisJob: AnalysisJob }>({
      query: POLL_ANALYSIS_JOB_QUERY,
      variables: { jobId },
      signal,
    });

    const job = data.analysisJob;

    if (job.status !== lastStatus) {
      lastStatus = job.status;
      onStatusChange?.(job.status);
    }

    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new Error(job.error ?? 'Analysis failed');

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); });
    });
  }

  throw new Error(`Analysis timed out after ${timeoutMs / 1000}s`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function analyzeImage(
  payload: UploadImagePayload,
  options?: PollOptions,
): Promise<{ job: AnalysisJob; result: AnalysisResult | null }> {
  const uploadData = await gqlUpload<{ uploadBPImage: AnalysisJob }>(
    UPLOAD_BP_IMAGE_MUTATION,
    { file: null },
    { uri: payload.imageUri, name: uriToFilename(payload.imageUri), type: uriToMime(payload.imageUri) },
    options?.signal,
  );

  const initial = uploadData.uploadBPImage;

  if (initial.status === 'done') {
    return { job: initial, result: initial.result ?? null };
  }

  const completed = await pollUntilDone(initial.jobId, options);
  return { job: completed, result: completed.result ?? null };
}

export async function submitReading(payload: SubmitReadingPayload): Promise<string> {
  const data = await gqlRequest<{ submitBPReading: { id: string } }>({
    query: SUBMIT_BP_READING_MUTATION,
    variables: {
      input: {
        jobId: payload.jobId,
        imageUri: payload.imageUri,
        systolic: payload.systolic,
        diastolic: payload.diastolic,
        pulse: payload.pulse,
        measuredAt: payload.measuredAt.toISOString(),
      },
    },
  });

  return data.submitBPReading.id;
}