import { analyzeImage, submitReading } from '@/services/camera.service';
import type { AnalysisJob, AnalysisResult, BPReading } from '@/types';
import { useCallback, useRef, useState } from 'react';

export type AnalysisPhase = 'idle' | 'uploading' | 'queued' | 'processing' | 'done' | 'failed';

const PHASE_MAP: Record<AnalysisJob['status'], AnalysisPhase> = {
  pending: 'queued',
  processing: 'processing',
  done: 'done',
  failed: 'failed',
};

export const PHASE_LABEL: Record<AnalysisPhase, string> = {
  idle: '',
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
  error: string | null;
}

const INITIAL_STATE: AnalysisState = {
  phase: 'idle',
  job: null,
  result: null,
  prefill: {},
  error: null,
};

const CONFIDENCE_THRESHOLD = 0.75;

export function useCameraAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  const analyze = useCallback(async (imageUri: string) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setState({ ...INITIAL_STATE, phase: 'uploading' });

    try {
      const { job, result } = await analyzeImage(
        { imageUri },
        {
          signal: abort.signal,
          onStatusChange: (status) => {
            setState((prev) => ({ ...prev, phase: PHASE_MAP[status] }));
          },
        },
      );

      const hasGoodReading = result && result.confidence >= CONFIDENCE_THRESHOLD && result.readings;

      setState({
        phase: 'done',
        job,
        result,
        prefill: hasGoodReading ? { ...result!.readings! } : {},
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
  }, []);

  const save = useCallback(
    async (params: { imageUri: string; systolic: number; diastolic: number; pulse: number }) => {
      const jobId = state.job?.jobId ?? `manual_${Date.now()}`;
      setIsSaving(true);
      try {
        return await submitReading({
          jobId,
          imageUri: params.imageUri,
          systolic: params.systolic,
          diastolic: params.diastolic,
          pulse: params.pulse,
          measuredAt: new Date(),
        });
      } finally {
        setIsSaving(false);
      }
    },
    [state.job],
  );

  return { ...state, isSaving, analyze, save, reset };
}