import { getAuthToken } from '@/src/constants/api';
import {
    AI_POLL_INTERVAL_MS,
    AI_POLL_TIMEOUT_MS,
} from '@/src/core/config/constants';
import { gqlRequest } from '@/src/core/graphql/client';
import { cameraDebug } from '@/src/store/shared/log';
import type {
    AnalysisJob,
    AnalysisResult,
    UploadImagePayload,
} from '@/src/types';
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

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
  // RN's Blob refuses ArrayBuffer/Uint8Array, so on native we hand the
  // file URI to FileSystem.uploadAsync and stream the binary from disk to
  // S3 without ever materializing a Blob. Web has a real Blob so we keep
  // the fetch+Blob path there for parity.
  const isWeb = Platform.OS === 'web';
  let size: number;
  let webBytes: Uint8Array | null = null;
  if (isWeb) {
    webBytes = await new File(imageUri).bytes();
    size = webBytes.byteLength;
  } else {
    size = new File(imageUri).size;
  }

  const presign = await gqlRequest<{ requestImageUpload: PresignedUpload }>({
    query: REQUEST_IMAGE_UPLOAD_MUTATION,
    variables: {
      input: { kind: 'BLOOD_PRESSURE_READING', mimeType, size },
    },
    signal,
  });

  const { uploadUrl, key, headers } = presign.requestImageUpload;
  cameraDebug('presign issued', {
    key,
    mimeType,
    size,
    expiresAt: presign.requestImageUpload.expiresAt,
  });
  const headerMap: Record<string, string> = {};
  for (const h of headers) headerMap[h.name] = h.value;

  let putStatus: number;
  if (isWeb) {
    // Cast: expo-file-system returns Uint8Array<ArrayBuffer>, but the generic
    // collapses at this call site so BlobPart's strict typing rejects it.
    const body = new Blob([webBytes as Uint8Array<ArrayBuffer>], { type: mimeType });
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: headerMap,
      body,
      signal,
    });
    putStatus = putRes.status;
  } else {
    // uploadAsync has no AbortSignal hook; the parent flow's cancellation
    // is enforced by the GraphQL polling step that follows.
    const result = await LegacyFileSystem.uploadAsync(uploadUrl, imageUri, {
      httpMethod: 'PUT',
      headers: headerMap,
      uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
    });
    putStatus = result.status;
  }
  if (putStatus < 200 || putStatus >= 300) {
    throw new Error(`S3 upload rejected (${putStatus})`);
  }
  cameraDebug('S3 PUT ok', { key, status: putStatus });

  const confirmed = await gqlRequest<{ confirmImageUpload: ConfirmedImage }>({
    query: CONFIRM_IMAGE_UPLOAD_MUTATION,
    variables: {
      input: { key, kind: 'BLOOD_PRESSURE_READING' },
    },
    signal,
  });
  cameraDebug('confirmImageUpload ok', {
    key: confirmed.confirmImageUpload.key,
    imageId: confirmed.confirmImageUpload.imageId,
    url: confirmed.confirmImageUpload.url,
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
  const {
    intervalMs = AI_POLL_INTERVAL_MS,
    timeoutMs = AI_POLL_TIMEOUT_MS,
    signal,
    onStatusChange,
  } = options;
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
      cameraDebug('analysisJob status', { jobId, from: lastStatus, to: job.status });
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
  cameraDebug('analyzeBPImage enqueued', {
    jobId: initial.jobId,
    status: initial.status,
    s3Key: key,
  });
  if (initial.status === 'done') {
    return { job: initial, result: initial.result ?? null, uploadedUrl: url };
  }

  const completed = await pollUntilDone(initial.jobId, options);
  cameraDebug('analyzeBPImage finished', {
    jobId: completed.jobId,
    status: completed.status,
    hasResult: !!completed.result,
  });
  return {
    job: completed,
    result: completed.result ?? null,
    uploadedUrl: url,
  };
}

