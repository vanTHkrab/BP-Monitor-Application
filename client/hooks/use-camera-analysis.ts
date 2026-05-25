import { analyzeImage } from '@/services/camera.service';
import {
  preflightCheckImage,
  type PreflightResult,
} from '@/services/preflight-detection.service';
import { useAppStore } from '@/store/use-app-store';
import type { AnalysisJob, AnalysisResult, BPReading, OcrEngine } from '@/types';
import { useCallback, useRef, useState } from 'react';

export type AnalysisPhase =
  | 'idle'
  | 'preflight'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'done'
  | 'failed';

const PHASE_MAP: Record<AnalysisJob['status'], AnalysisPhase> = {
  pending: 'queued',
  processing: 'processing',
  done: 'done',
  failed: 'failed',
};

export const PHASE_LABEL: Record<AnalysisPhase, string> = {
  idle: '',
  preflight: 'กำลังตรวจสอบภาพ...',
  uploading: 'กำลังอัปโหลด...',
  queued: 'รอ AI วิเคราะห์...',
  processing: 'AI กำลังอ่านค่า...',
  done: 'วิเคราะห์เสร็จแล้ว ✓',
  failed: 'วิเคราะห์ไม่สำเร็จ',
};

interface AnalysisState {
  phase: AnalysisPhase;
  job: AnalysisJob | null;
  result: AnalysisResult | null;
  prefill: Partial<BPReading>;
  /** Public URL of the uploaded image once analyze succeeds. Passed to
   *  `createReading` on save so the store doesn't re-upload — it sees the
   *  `https://` prefix and goes straight to the GraphQL submit. */
  uploadedUrl: string | null;
  /** Server-side Image.id from ``confirmImageUpload`` carried alongside
   *  ``uploadedUrl``; ``createReading`` attaches the new reading to this
   *  image via FK. ``null`` until upload succeeds. */
  uploadedImageId: number | null;
  error: string | null;
}

const INITIAL_STATE: AnalysisState = {
  phase: 'idle',
  job: null,
  result: null,
  prefill: {},
  uploadedUrl: null,
  uploadedImageId: null,
  error: null,
};

const CONFIDENCE_THRESHOLD = 0.70;

export function useCameraAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  const analyze = useCallback(
    async (imageUri: string, opts?: { ocrEngine?: OcrEngine }) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setState({ ...INITIAL_STATE, phase: 'uploading' });

      try {
        const { job, result, uploadedUrl, uploadedImageId } = await analyzeImage(
          { imageUri },
          {
            signal: abort.signal,
            ...(opts?.ocrEngine ? { ocrEngine: opts.ocrEngine } : {}),
            onStatusChange: (status) => {
              setState((prev) => ({ ...prev, phase: PHASE_MAP[status] }));
            },
          },
        );

        const hasGoodReading =
          result && result.confidence >= CONFIDENCE_THRESHOLD && result.readings;

        setState({
          phase: 'done',
          job,
          result,
          prefill: hasGoodReading ? { ...result!.readings! } : {},
          uploadedUrl,
          uploadedImageId,
          error: null,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          phase: 'failed',
          error: (err as Error).message ?? 'วิเคราะห์ไม่สำเร็จ',
        }));
      }
    },
    [],
  );

  const save = useCallback(
    async (params: { imageUri: string; systolic: number; diastolic: number; pulse: number }) => {
      // Route through the store so we inherit the offline queue + optimistic
      // UI used by manual entry. If analyze succeeded, `uploadedUrl` is the
      // already-S3-hosted URL and `uploadedImageId` is the FK the gateway
      // needs to attach the new reading to the existing Image row; the
      // store skips re-uploading. If analyze failed or the user is offline,
      // fall back to the captured local URI with imageId=null;
      // `syncPendingReadings` will upload-then-submit when network returns.
      setIsSaving(true);
      try {
        const ok = await useAppStore.getState().createReading({
          systolic: params.systolic,
          diastolic: params.diastolic,
          pulse: params.pulse,
          measuredAt: new Date(),
          imageUri: state.uploadedUrl ?? params.imageUri,
          imageId: state.uploadedImageId ?? undefined,
        });
        return ok;
      } finally {
        setIsSaving(false);
      }
    },
    [state.uploadedUrl, state.uploadedImageId],
  );

  return { ...state, isSaving, runPreflight, analyze, save, reset };
}
