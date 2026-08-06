/**
 * The capture state machine: photo → numbers → saved reading.
 *
 * Two ways in, one way out. Online, the photo goes to the backend pipeline
 * (`analyze`). Offline, it goes to the on-device engine (`readOnDevice`).
 * Both return the same `ReadOutcome`, both raise the same `lowConfidence`
 * flag, and both end at the same `save`, so the offline path can never drift
 * into being a second, less tested way of recording a reading.
 *
 * **Nothing here can block a save.** Every failure — no network, no detector,
 * an unreadable display, a timeout — resolves to "the form is empty, type the
 * numbers". That is the whole design constraint: the patient came to record a
 * measurement, and the reading assistance is an optimisation on top of that.
 */
import { useCallback, useRef, useState } from 'react';

import { useCreateReading } from '@/modules/readings';

import { isOcrUnavailable } from '../lib/ocr/types';
import { readBpFromImage } from '../lib/ocr/read';
import { analyzeImage } from '../services/analysis-api';
import type { AnalysisJob, AnalysisJobStatus, AnalysisResult, BPValues, OcrEngine } from '../types';

export type AnalysisPhase =
  | 'idle'
  | 'reading'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'done'
  | 'failed';

const PHASE_BY_JOB_STATUS: Record<AnalysisJobStatus, AnalysisPhase> = {
  pending: 'queued',
  processing: 'processing',
  done: 'done',
  failed: 'failed',
};

export const PHASE_LABEL: Record<AnalysisPhase, string> = {
  idle: '',
  // Deliberately not "AI": on-device inference is running on this phone, and
  // telling the user otherwise sets the wrong expectation about the wait.
  reading: 'กำลังอ่านค่าในเครื่อง...',
  uploading: 'กำลังอัปโหลด...',
  queued: 'รอ AI วิเคราะห์...',
  processing: 'AI กำลังอ่านค่า...',
  done: 'วิเคราะห์เสร็จแล้ว ✓',
  failed: 'วิเคราะห์ไม่สำเร็จ',
};

/**
 * Below this, the values are shown for confirmation instead of filled in.
 *
 * The asymmetry is deliberate. A wrong number the user did not notice becomes
 * a wrong number in their medical history; a confirmation they have to tap
 * costs them a second. Same threshold for both engines, so "the app was sure"
 * means one thing.
 */
const CONFIDENCE_THRESHOLD = 0.5;

/**
 * What a read produced, handed back to the caller instead of being pushed
 * into a `prefill` field the screen then watched with an effect.
 *
 * Returning it is what lets the form be filled inside the handler that
 * awaited the read: an effect that writes form state from analysis state is a
 * cascading render, and it was also the subtler of the two places the
 * "don't clobber what the user typed" guard had to live.
 */
export type ReadOutcome = {
  readings: BPValues;
  /** False when the user should be asked to check the numbers first. */
  confident: boolean;
};

interface AnalysisState {
  phase: AnalysisPhase;
  job: AnalysisJob | null;
  result: AnalysisResult | null;
  /** Set once the online path has uploaded — carried into `save`. */
  uploadedImageId: number | null;
  /** Values came back, but not confidently. The screen asks before filling. */
  lowConfidence: boolean;
  error: string | null;
}

const INITIAL_STATE: AnalysisState = {
  phase: 'idle',
  job: null,
  result: null,
  uploadedImageId: null,
  lowConfidence: false,
  error: null,
};

export function useCameraAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const { createReading, isSaving } = useCreateReading();
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  /**
   * The offline read. Returns whether it produced anything, so the caller can
   * decide between "here are the numbers" and plain manual entry — it never
   * surfaces a failure as an error.
   */
  const readOnDevice = useCallback(async (imageUri: string): Promise<ReadOutcome | null> => {
    setState((prev) => ({ ...prev, phase: 'reading', error: null }));

    const ocr = await readBpFromImage({ imageUri });
    if (isOcrUnavailable(ocr)) {
      // Clear the phase, or the preview chip sits on "กำลังอ่านค่าในเครื่อง..."
      // forever after we have given up.
      setState((prev) => ({ ...prev, phase: 'idle' }));
      return null;
    }

    const readings: BPValues = { systolic: ocr.sys, diastolic: ocr.dia, pulse: ocr.pulse };
    const confident = ocr.confidence >= CONFIDENCE_THRESHOLD;

    setState((prev) => ({
      ...prev,
      phase: 'done',
      result: {
        readings,
        confidence: ocr.confidence,
        roiImageUrl: null,
        rawText: null,
        status: confident ? 'success' : 'low_confidence',
        engine: null,
        metrics: null,
      },
      lowConfidence: !confident,
      error: null,
    }));
    return { readings, confident };
  }, []);

  /** The online read. */
  const analyze = useCallback(
    async (
      imageUri: string,
      options?: { ocrEngine?: OcrEngine },
    ): Promise<ReadOutcome | null> => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setState({ ...INITIAL_STATE, phase: 'uploading' });

    try {
      const { job, result, uploadedImageId } = await analyzeImage(imageUri, {
        signal: abort.signal,
        ...(options?.ocrEngine ? { ocrEngine: options.ocrEngine } : {}),
        onStatusChange: (status) =>
          setState((prev) => ({ ...prev, phase: PHASE_BY_JOB_STATUS[status] })),
      });

      const confident = Boolean(
        result?.readings && result.confidence >= CONFIDENCE_THRESHOLD,
      );
      const lowConfidence = Boolean(
        result?.readings && result.confidence < CONFIDENCE_THRESHOLD,
      );

      setState((prev) => ({
        ...prev,
        phase: 'done',
        job,
        result,
        uploadedImageId,
        lowConfidence,
        error: null,
      }));

      return result?.readings ? { readings: result.readings, confident } : null;
    } catch (error) {
      // A cancelled analysis is the user moving on, not a failure to report.
      if (error instanceof Error && error.name === 'AbortError') return null;
      setState((prev) => ({
        ...prev,
        phase: 'failed',
        error: error instanceof Error ? error.message : 'วิเคราะห์ไม่สำเร็จ',
      }));
      return null;
    }
    },
    [],
  );

/**
   * The user has resolved the "please check these numbers" banner, either way.
   *
   * Only the flag lives here. Whether the values end up in the form is the
   * screen's call, because the screen owns the form — and `result.readings` is
   * already exposed for it to read.
   */
  const dismissLowConfidence = useCallback(() => {
    setState((prev) => ({ ...prev, lowConfidence: false }));
  }, []);

  /**
   * Save through the readings queue, so the camera inherits the same durable
   * write manual entry uses.
   *
   * `measuredAt` is the *capture* time, passed in by the screen. An offline
   * capture saved an hour later has to keep the time the measurement was
   * actually taken — this is the detail most likely to be lost in a rewrite.
   *
   * `uploadedImageId` matters just as much: when the online path already put
   * the photo on S3, sending the id stops the drain uploading it a second time.
   */
  const save = useCallback(
    (
      params: {
        imageUri: string;
        measuredAt: Date;
        /** Set when a caregiver is recording for the patient they are viewing. */
        patientId?: string;
      } & BPValues,
    ): Promise<string> =>
      createReading({
        systolic: params.systolic,
        diastolic: params.diastolic,
        pulse: params.pulse,
        measuredAt: params.measuredAt,
        imageUri: params.imageUri,
        imageId: state.uploadedImageId ?? undefined,
        patientId: params.patientId,
      }),
    [createReading, state.uploadedImageId],
  );

  return {
    ...state,
    isSaving,
    readOnDevice,
    analyze,
    save,
    reset,
    dismissLowConfidence,
  };
}
