import { isOcrUnavailable, readBpFromImage } from '@/lib/ocr';
import { analyzeImage } from '@/services/camera.service';
import {
  preflightCheckImage,
  type PreflightResult,
} from '@/services/preflight-detection.service';
import { useAppStore } from '@/store/use-app-store';
import { logWarn } from '@/store/shared/log';
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
  /** Latest pre-flight result. The camera screen reads `.status` to decide
   *  whether to auto-continue with the cropped variant or show the warning
   *  banner. `null` before the first runPreflight call or when it threw. */
  preflight: PreflightResult | null;  
  /** Public URL of the uploaded image once analyze succeeds. Passed to
   *  `createReading` on save so the store doesn't re-upload — it sees the
   *  `https://` prefix and goes straight to the GraphQL submit. */
  uploadedUrl: string | null;
  /** Server-side Image.id from ``confirmImageUpload`` carried alongside
   *  ``uploadedUrl``; ``createReading`` attaches the new reading to this
   *  image via FK. ``null`` until upload succeeds. */
  uploadedImageId: number | null;
  /** True when the backend returned readings but its confidence fell below
   *  ``CONFIDENCE_THRESHOLD``. The camera screen shows a confirmation popup
   *  (the read values + confirm / cancel) instead of silently auto-filling.
   *  Cleared once the user resolves the prompt via ``confirmLowConfidence`` /
   *  ``dismissLowConfidence``. */
  lowConfidence: boolean;
  error: string | null;
}

const INITIAL_STATE: AnalysisState = {
  phase: 'idle',
  job: null,
  result: null,
  prefill: {},
  preflight: null,
  uploadedUrl: null,
  uploadedImageId: null,
  lowConfidence: false,
  error: null,
};

const CONFIDENCE_THRESHOLD = 0.50;

export function useCameraAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  /**
   * Run the on-device YOLO pre-flight check. Doesn't kick off the backend
   * analysis — the camera screen inspects `state.preflight.status` and
   * decides whether to auto-call `analyze(croppedUri)` or surface a warning
   * with a "send anyway" button that calls `analyze(originalUri)`.
   *
   * On failure (model load error, JPEG decode error, …) we return `null` and
   * leave `preflight === null` so the UI falls back to the legacy "just
   * upload" path — pre-flight is an optimisation, not a gate.
   */
  const runPreflight = useCallback(
    async (params: {
      imageUri: string;
      sourceWidth: number;
      sourceHeight: number;
    }): Promise<PreflightResult | null> => {
      setState((prev) => ({ ...prev, phase: 'preflight', error: null }));
      try {
        const result = await preflightCheckImage(params);
        setState((prev) => ({ ...prev, phase: 'idle', preflight: result }));
        return result;
      } catch (err) {
        logWarn('preflight', 'on-device YOLO failed; skipping pre-flight', err);
        setState((prev) => ({ ...prev, phase: 'idle', preflight: null }));
        return null;
      }
    },
    [],
  );

  /**
   * Run the on-device OCR engine (offline counterpart of `analyze` — the
   * bp-vision native pipeline on Android; `readBpFromImage` reports
   * unavailable on iOS / web / Expo Go and on any ordinary read failure,
   * never throwing). The camera screen calls this only when offline; a
   * successful read feeds the SAME prefill + low-confidence confirm flow
   * the backend result uses.
   *
   * Returns `true` when values were produced (state updated), `false` when
   * the caller should fall through to plain manual entry.
   */
  const readOnDevice = useCallback(async (imageUri: string): Promise<boolean> => {
    console.log('[readOnDevice] starting OCR for', imageUri);
    setState((prev) => ({ ...prev, phase: 'processing', error: null }));
    try {
      const ocr = await readBpFromImage({ imageUri });
      if (isOcrUnavailable(ocr)) {
        // Expected while the model is a stub; log-only so the offline flow
        // proceeds straight to manual entry with zero UI churn.
        if (__DEV__) console.log('[readOnDevice] unavailable:', ocr.reason);
        return false;
      }
      const readings = { systolic: ocr.sys, diastolic: ocr.dia, pulse: ocr.pulse };
      const confident = ocr.confidence >= CONFIDENCE_THRESHOLD;
      const result: AnalysisResult = {
        readings,
        confidence: ocr.confidence,
        roiImageUrl: null,
        rawText: null,
        status: confident ? 'success' : 'low_confidence',
        engine: null,
        metrics: null,
      };
      // Mirrors the tail of `analyze()`: confident reads prefill the form,
      // uncertain ones raise the low-confidence confirm banner (resolved by
      // confirmLowConfidence / dismissLowConfidence exactly as for backend
      // results). No uploadedUrl/uploadedImageId — the image is still local
      // and `save()` → `createReading` handles the queued upload.
      setState((prev) => ({
        ...prev,
        phase: 'done',
        result,
        prefill: confident ? { ...readings } : {},
        lowConfidence: !confident,
        error: null,
      }));
      return true;
    } catch (err) {
      logWarn('ocr', 'on-device OCR failed; falling back to manual entry', err);
      return false;
    }
  }, []);

  const analyze = useCallback(
    async (imageUri: string, opts?: { ocrEngine?: OcrEngine }) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setState((prev) => ({
        ...prev,
        phase: 'uploading',
        job: null,
        result: null,
        prefill: {},
        uploadedUrl: null,
        uploadedImageId: null,
        lowConfidence: false,
        error: null,
      }));

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
        // Readings came back but the model wasn't confident enough to
        // auto-fill. We don't drop them on the floor — the screen surfaces a
        // confirmation popup so the user can eyeball the values against the
        // monitor and opt in (confirmLowConfidence) or enter manually.
        const lowConfidence = Boolean(
          result && result.readings && result.confidence < CONFIDENCE_THRESHOLD,
        );

        if (__DEV__) {
          console.log('[analyze]', {
            confidence: result?.confidence,
            threshold: CONFIDENCE_THRESHOLD,
            readings: result?.readings,
            willPrefill: Boolean(hasGoodReading),
            lowConfidence,
          });
        }

        setState((prev) => ({
          ...prev,
          phase: 'done',
          job,
          result,
          prefill: hasGoodReading ? { ...result!.readings! } : {},
          uploadedUrl,
          uploadedImageId,
          lowConfidence,
          error: null,
        }));
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

  /** User accepted the low-confidence reading from the popup — promote the
   *  AI values into `prefill` so the auto-fill effect populates the form, and
   *  clear the `lowConfidence` flag so the popup doesn't fire again. */
  const confirmLowConfidence = useCallback(() => {
    setState((prev) =>
      prev.result?.readings
        ? { ...prev, prefill: { ...prev.result.readings }, lowConfidence: false }
        : { ...prev, lowConfidence: false },
    );
  }, []);

  /** User dismissed the popup — leave the form empty for manual entry and
   *  clear the flag so it doesn't re-trigger. */
  const dismissLowConfidence = useCallback(() => {
    setState((prev) => ({ ...prev, lowConfidence: false }));
  }, []);

  const save = useCallback(
    async (params: {
      imageUri: string;
      systolic: number;
      diastolic: number;
      pulse: number;
      /** When the reading came from a photo, the moment the photo was
       *  captured — that IS the measurement time. Without it (manual entry
       *  with no capture timestamp) we fall back to now. Matters offline:
       *  capture-then-late-save must not shift the measurement time. */
      measuredAt?: Date;
    }) => {
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
          measuredAt: params.measuredAt ?? new Date(),
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

  return {
    ...state,
    isSaving,
    runPreflight,
    readOnDevice,
    analyze,
    save,
    reset,
    confirmLowConfidence,
    dismissLowConfidence,
  };
}
