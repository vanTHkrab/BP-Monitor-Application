/**
 * Public surface of the capture module: photo in, saved reading out.
 *
 * The camera screen is the only consumer. `services/analysis-api.ts` and
 * `lib/ocr/read.ts` stay unexported — a screen calling them directly would get
 * numbers with no path to a durable save, which is the one thing this flow
 * exists to guarantee.
 *
 * `lib/framing-state.ts` is exported for its types and its thresholds, because
 * tuning them is expected work and they are the module's most likely reason to
 * be touched from outside.
 *
 * The two `prepare*ForAnalysis` entry points are separate on purpose rather
 * than one function with an optional viewport: the live-camera path crops back
 * to what the preview showed and a gallery pick must not, and which one a
 * caller means should be visible at the call site, not inferred from whether
 * an argument was passed.
 */
export { BpCameraView, isLiveDetectionSupported } from './components/bp-camera-view';
export type {
  BpCameraCapture,
  BpCameraDetectionFrame,
  BpCameraViewRef,
} from './components/bp-camera-view';

export { PHASE_LABEL, useCameraAnalysis, type AnalysisPhase } from './hooks/use-camera-analysis';
export {
  AUTO_COUNTDOWN_MS,
  AUTO_COUNTDOWN_MS_A11Y,
  useLiveFraming,
} from './hooks/use-live-framing';

export { computeCoverCropBox } from './lib/crop-to-viewport';
export { prepareCaptureForAnalysis, prepareImageForAnalysis } from './lib/image-prepare';
export {
  DEFAULT_FRAMING_THRESHOLDS,
  FRAMING_DWELL_MS,
  type FramingState,
  type FramingThresholds,
} from './lib/framing-state';

export { CLASS_NAMES, type Detection } from './lib/detection';
export type { OnDeviceOcrResult } from './lib/ocr/types';

export type {
  AnalysisJob,
  AnalysisMetrics,
  AnalysisResult,
  BPValues,
  CapturedPhoto,
  OcrEngine,
} from './types';
export { OCR_ENGINES, OCR_ENGINE_LABELS } from './types';
