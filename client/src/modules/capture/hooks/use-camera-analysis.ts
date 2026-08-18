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
 * below), and so does a superseded `readOnDevice()` call. The screen's
 * online and offline branches both use that split to decide whether to
 * react to the promise settling at all, not just what to fill — an
 * `{ confident: false, readings: null }` object means "this ran, and found
 * nothing," which is worth surfacing; a bare `null` means "there is nothing
 * here to react to."
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
  /**
   * Values came back, but not confidently. The screen fills them in anyway
   * (same as a confident read) and asks the user to double check, rather
   * than withholding them until they choose to accept.
   */
  lowConfidence: boolean;
  /**
   * The engine ran — on-device or backend — and produced nothing. Distinct
   * from `lowConfidence`: there are no values to offer here, only a reason
   * to prompt a retake or, failing that, manual entry.
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
  /**
   * `readOnDevice`'s equivalent of `abortRef` — a generation counter rather
   * than an `AbortController`, because there is no request to cancel here,
   * only a background inference call whose result can be ignored. Bumped at
   * the top of every `readOnDevice` call *and* by `reset()` below; a call
   * whose captured generation no longer matches this ref's current value
   * when `readBpFromImage` resolves knows a newer call — or a reset with no
   * new call yet — has superseded it, and skips every `setState` from that
   * point on. The same "the user already moved on, say nothing" contract
   * `analyze`'s `AbortError` branch gives the online path.
   *
   * The `reset()` bump matters on its own: `reset` is `retake`'s only hook
   * into this state, and a retake does not guarantee the *next* capture is
   * also offline. Without this, an on-device read orphaned by a retake into
   * an online capture has no later `readOnDevice` call to invalidate it —
   * its generation would still read as current — and its late completion
   * would overwrite whatever the online capture already committed.
   */
  const offlineReadGenerationRef = useRef(0);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    offlineReadGenerationRef.current += 1;
    setState(INITIAL_STATE);
  }, []);

  /**
   * The offline read. Returns whether it produced anything, so the caller can
   * decide between "here are the numbers" and plain manual entry — it never
   * surfaces a failure as an error.
   */
  const readOnDevice = useCallback(async (imageUri: string): Promise<ReadOutcome | null> => {
    const generation = ++offlineReadGenerationRef.current;

    setState((prev) => ({ ...prev, phase: 'reading', error: null }));

    const ocr = await readBpFromImage({ imageUri });

    if (generation !== offlineReadGenerationRef.current) {
      // Either a newer call to `readOnDevice` started, or `reset()` ran with
      // no new call yet (a retake into an online capture, most often) —
      // either way this result belongs to a photo the user has already
      // moved past. No `setState`, and a `null` return the caller cannot
      // tell apart from "no engine on this platform": either way there is
      // nothing for it to react to (see `captureGenerationRef` in
      // `camera.tsx`, which is what actually keeps the caller from reacting
      // to a superseded call at all, regardless of what it returns).
      return null;
    }

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
      // unreadable dialog it drives (`showUnreadableAlert` in `camera.tsx`).
      // Returns a real, non-null outcome rather than `null`: the caller
      // needs to tell "ran, found nothing" apart from "no engine here at
      // all" now that the two lead to different reactions (a dialog vs. a
      // silently-opened sheet), and `{ confident: false, readings: null }`
      // is exactly what `ReadOutcome` already has the shape to say.
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
      return { confident: false, readings: null };
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
   * The user has acknowledged the "please check these numbers" banner. The
   * values themselves are auto-applied into the form as soon as the read
   * settles (`applyOutcomeReadings` in `camera.tsx`), so unlike the old
   * two-button version of this banner there is no longer a choice to make
   * here — only the flag lives here, and clearing it just hides the banner.
   */
  const dismissLowConfidence = useCallback(() => {
    setState((prev) => ({ ...prev, lowConfidence: false }));
  }, []);

  /**
   * The user has picked "กรอกเอง" on the unreadable dialog — acknowledging
   * "we couldn't read this photo" and moving on to manual entry, rather than
   * the dialog's other action (`retake`, which resets this whole hook via
   * `reset` instead). Unlike `dismissLowConfidence`, there are no values to
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
