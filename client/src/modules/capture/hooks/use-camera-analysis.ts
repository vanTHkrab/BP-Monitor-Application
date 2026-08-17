/**
 * The capture state machine: photo → numbers → saved reading.
 *
 * Two ways in, one way out. Online, the photo goes to the backend pipeline
 * (`analyze`). Offline, it goes to the on-device engine (`readOnDevice`).
 * Both return the same `ReadOutcome`, both raise the same `lowConfidence` /
 * `unreadable` flags, and both end at the same `save`, so the offline path
 * can never drift into being a second, less tested way of recording a
 * reading.
 *
 * **Nothing here can block a save.** Every failure — no network, no detector,
 * an unreadable display, a timeout — still resolves to "the form is empty,
 * type the numbers". What changed is whether the patient is told *why* it is
 * empty: a photo the engine genuinely could not read now sets `unreadable`,
 * rather than failing exactly as silently as a platform with no on-device
 * engine at all. That is still the whole design constraint underneath it: the
 * patient came to record a measurement, and the reading assistance —
 * including telling them it did not work — is an optimisation on top of that,
 * never a gate in front of it.
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
 *
 * `readings` is nullable for exactly one reason: a completed analysis that
 * read nothing (`unreadable`) still has to be distinguishable, by the
 * returned value alone, from an analysis that never settled at all — an
 * aborted or hard-failed `analyze()` call returns `null` outright (see
 * below). The screen's online branch uses that split to decide whether to
 * react to the promise settling, not just what to fill.
 */
export type ReadOutcome =
  | { confident: true; readings: BPValues }
  /** False when the user should be asked to check the numbers first, or
   *  (`readings: null`) when there was nothing to check at all. */
  | { confident: false; readings: BPValues | null };

interface AnalysisState {
  phase: AnalysisPhase;
  job: AnalysisJob | null;
  result: AnalysisResult | null;
  /** Set once the online path has uploaded — carried into `save`. */
  uploadedImageId: number | null;
  /** Values came back, but not confidently. The screen asks before filling. */
  lowConfidence: boolean;
  /**
   * The engine ran — on-device or backend — and produced nothing. Distinct
   * from `lowConfidence`: there are no values to offer here, only a reason
   * to fall back to manual entry.
   */
  unreadable: boolean;
  error: string | null;
}

const INITIAL_STATE: AnalysisState = {
  phase: 'idle',
  job: null,
  result: null,
  uploadedImageId: null,
  lowConfidence: false,
  unreadable: false,
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
      if (ocr.platformUnsupported) {
        // No engine on this device at all (iOS, web, Expo Go) — the
        // expected, every-time outcome there, not a failure. Clear the
        // phase, or the preview chip sits on "กำลังอ่านค่าในเครื่อง..." forever
        // after we have given up, and stay exactly as silent as before.
        setState((prev) => ({ ...prev, phase: 'idle' }));
        return null;
      }
      // The engine exists here and ran on this photo, but produced nothing:
      // no monitor found, unreadable digits, an implausible value, or an
      // unexpected native error. Unlike the platform-absence case above,
      // this is a per-photo outcome worth telling the user about — see the
      // `unreadable` banner it drives. Still returns `null`: the screen's
      // offline branch already opens the entry sheet unconditionally, so
      // there is nothing left for the return value to distinguish here
      // (contrast `analyze`, whose caller does need that distinction).
      setState((prev) => ({
        ...prev,
        phase: 'done',
        result: {
          readings: null,
          confidence: 0,
          roiImageUrl: null,
          rawText: null,
          status: 'unreadable',
          engine: null,
          metrics: null,
        },
        unreadable: true,
        lowConfidence: false,
        error: null,
      }));
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
      unreadable: false,
      error: null,
    }));
    return confident ? { confident: true, readings } : { confident: false, readings };
  }, []);

  /** The online read. */
  const analyze = useCallback(
    async (
      imageUri: string,
      options?: {
        ocrEngine?: OcrEngine;
        /**
         * Called synchronously, in the same tick as the `setState` below —
         * deliberately not left for the caller's own `.then()` on the
         * promise this function returns. A `.then()` chained onto an async
         * function's own return is always a separate microtask (settling a
         * promise never runs its continuations inline), so a caller reacting
         * that way is not guaranteed to land in the same React commit as
         * `phase: 'done'` landing here — two renders, not one, and on a slow
         * device that gap is a visible beat between the phase pill reading
         * "วิเคราะห์เสร็จแล้ว ✓" and whatever the caller does in response (the
         * entry sheet opening, in `startCaptureFlow`). Calling it here, right
         * next to the state update it needs to land with, is what makes
         * React 18's automatic batching actually apply.
         */
        onSettled?: (outcome: ReadOutcome | null) => void;
      },
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
      const unreadable = result?.status === 'unreadable';

      // `null` only for "nothing settled here" (an aborted request, below,
      // or the absence of a result object at all — a malformed reply this
      // defends against but should not itself happen). The caller
      // (`startCaptureFlow`'s online branch) uses that to decide whether to
      // react at all: a completed job returns an object even when there is
      // nothing to prefill, so "the pipeline finished" (confident,
      // low-confidence, or unreadable) is distinguishable from "the user
      // already moved on" or a hard failure, which already has its own
      // recovery banner on this screen.
      const outcome: ReadOutcome | null = !result
        ? null
        : result.readings && confident
          ? { confident: true, readings: result.readings }
          : { confident: false, readings: result.readings };

      options?.onSettled?.(outcome);

      setState((prev) => ({
        ...prev,
        phase: 'done',
        job,
        result,
        uploadedImageId,
        lowConfidence,
        unreadable,
        error: null,
      }));

      return outcome;
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
   * The user has acknowledged "we couldn't read this photo" and is moving on
   * to manual entry. Unlike `dismissLowConfidence`, there are no values to
   * offer here — this only clears the flag.
   */
  const dismissUnreadable = useCallback(() => {
    setState((prev) => ({ ...prev, unreadable: false }));
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
    dismissUnreadable,
  };
}
