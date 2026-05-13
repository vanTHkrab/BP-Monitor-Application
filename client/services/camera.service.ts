import { File } from 'expo-file-system';
import { getAuthToken } from '@/constants/api';
import { gqlRequest } from '@/lib/graphql-client';
import type {
  AnalysisJob,
  AnalysisResult,
  UploadImagePayload,
} from '@/types';

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

const REQUEST_IMAGE_UPLOAD_MUTATION = `
  mutation RequestImageUpload($input: RequestImageUploadInput!) {
    requestImageUpload(input: $input) {
      uploadUrl
      key
      headers { name value }
      expiresAt
    }
  }
`;

const CONFIRM_IMAGE_UPLOAD_MUTATION = `
  mutation ConfirmImageUpload($input: ConfirmImageUploadInput!) {
    confirmImageUpload(input: $input) { key url imageId }
  }
`;

const ANALYZE_BP_IMAGE_MUTATION = `
  ${ANALYSIS_JOB_FRAGMENT}
  mutation AnalyzeBPImage($input: AnalyzeBPImageInput!) {
    analyzeBPImage(input: $input) { ...AnalysisJobFields }
  }
`;

const POLL_ANALYSIS_JOB_QUERY = `
  ${ANALYSIS_JOB_FRAGMENT}
  query PollAnalysisJob($jobId: String!) {
    analysisJob(jobId: $jobId) { ...AnalysisJobFields }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PresignedUpload {
  uploadUrl: string;
  key: string;
  headers: { name: string; value: string }[];
  expiresAt: string;
}

interface ConfirmedImage {
  key: string;
  url: string;
  imageId: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uriToMime(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    webp: 'image/webp',
  };
  return map[ext] ?? 'image/jpeg';
}

// ─── Presigned upload pipeline ────────────────────────────────────────────────

async function uploadToS3(
  imageUri: string,
  signal?: AbortSignal,
): Promise<{ key: string; url: string; mimeType: string }> {
  const mimeType = uriToMime(imageUri);
  const bytes = await new File(imageUri).bytes();
  const size = bytes.byteLength;

  const presign = await gqlRequest<{ requestImageUpload: PresignedUpload }>({
    query: REQUEST_IMAGE_UPLOAD_MUTATION,
    variables: {
      input: { kind: 'BLOOD_PRESSURE_READING', mimeType, size },
    },
    signal,
  });

  const { uploadUrl, key, headers } = presign.requestImageUpload;
  const headerMap: Record<string, string> = {};
  for (const h of headers) headerMap[h.name] = h.value;

  // Cast: expo-file-system returns Uint8Array<ArrayBuffer>, but the generic
  // collapses at this call site so BlobPart's strict typing rejects it.
  const body = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: headerMap,
    body,
    signal,
  });
  if (!putRes.ok) {
    throw new Error(`S3 upload rejected (${putRes.status})`);
  }

  const confirmed = await gqlRequest<{ confirmImageUpload: ConfirmedImage }>({
    query: CONFIRM_IMAGE_UPLOAD_MUTATION,
    variables: {
      input: { key, kind: 'BLOOD_PRESSURE_READING' },
    },
    signal,
  });

  return {
    key: confirmed.confirmImageUpload.key,
    url: confirmed.confirmImageUpload.url,
    mimeType,
  };
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
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }

  throw new Error(`Analysis timed out after ${timeoutMs / 1000}s`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function analyzeImage(
  payload: UploadImagePayload,
  options?: PollOptions,
): Promise<{
  job: AnalysisJob;
  result: AnalysisResult | null;
  /** Public URL of the uploaded image — pass this to `createReading` as
   *  `imageUri` so the store can submit the reading without re-uploading. */
  uploadedUrl: string;
}> {
  // Auth is required to presign — fail fast with a useful message rather
  // than letting the request fall through and get rejected by the gateway.
  if (!(await getAuthToken())) {
    throw new Error('ต้องเข้าสู่ระบบก่อนวิเคราะห์รูป');
  }

  const { key, url, mimeType } = await uploadToS3(
    payload.imageUri,
    options?.signal,
  );

  const enqueued = await gqlRequest<{ analyzeBPImage: AnalysisJob }>({
    query: ANALYZE_BP_IMAGE_MUTATION,
    variables: { input: { s3Key: key, mimeType } },
    signal: options?.signal,
  });

  const initial = enqueued.analyzeBPImage;
  if (initial.status === 'done') {
    return { job: initial, result: initial.result ?? null, uploadedUrl: url };
  }

  const completed = await pollUntilDone(initial.jobId, options);
  return {
    job: completed,
    result: completed.result ?? null,
    uploadedUrl: url,
  };
}

