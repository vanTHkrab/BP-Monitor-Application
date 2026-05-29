/**
 * Lazy-loaded, process-wide YOLO InferenceSession.
 *
 * The model is bundled (~11.5 MB) via require() — Metro treats `.onnx` as an
 * asset extension (see metro.config.js). On first call we use expo-asset to
 * materialise the asset to a local file URI, then hand that to
 * onnxruntime-react-native's InferenceSession.create.
 *
 * The session is held in a module-level singleton so subsequent detections
 * skip the ~200–500 ms cold-start cost on mid-range Android devices.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Asset } from 'expo-asset';
import type { InferenceSession } from 'onnxruntime-react-native';

let sessionPromise: Promise<InferenceSession> | null = null;

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Tells callers whether on-device YOLO is even possible on this runtime.
 * False in Expo Go (no native module) so they can short-circuit before
 * paying the asset-download cost / triggering a noisy error per tick.
 */
export function isYoloAvailable(): boolean {
  return !isExpoGo;
}

const EXPO_GO_MESSAGE =
  'onnxruntime-react-native unavailable in Expo Go — use a development build for on-device pre-flight';

export function getYoloSession(): Promise<InferenceSession> {
  if (sessionPromise) return sessionPromise;

  // Short-circuit before touching the native module. In Expo Go,
  // require('onnxruntime-react-native') succeeds but the package's JSI
  // install side-effect throws "Cannot read property 'install' of null"
  // *outside* our try/catch — preflight the env instead.
  if (isExpoGo) {
    return Promise.reject(new Error(EXPO_GO_MESSAGE));
  }

  sessionPromise = (async () => {
    // Lazy-require so apps without the native module installed (e.g. a dev
    // client that hasn't been rebuilt after adding onnxruntime-react-native)
    // don't crash at module load. The caller
    // (services/preflight-detection.service.ts → use-camera-analysis.ts)
    // catches the thrown error and falls through to backend-only analysis.
    let InferenceSessionCtor: typeof InferenceSession;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ InferenceSession: InferenceSessionCtor } = require('onnxruntime-react-native'));
    } catch (err) {
      throw new Error(
        'onnxruntime-react-native unavailable — rebuild the dev client',
        { cause: err as Error },
      );
    }

    // The require() is intentionally inline so Metro picks it up as a
    // require-time asset reference rather than a runtime string path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = Asset.fromModule(require('../../assets/models/yolo12n.onnx'));
    await asset.downloadAsync();

    const localUri = asset.localUri ?? asset.uri;
    if (!localUri) {
      throw new Error('getYoloSession: asset has no localUri after downloadAsync');
    }

    // InferenceSession.create accepts a file path (sans the file:// prefix on
    // some platforms — strip it defensively).
    const path = localUri.replace(/^file:\/\//, '');
    return InferenceSessionCtor.create(path);
  })().catch((err) => {
    // Reset so a subsequent call retries — otherwise a transient asset
    // download failure would poison the singleton for the whole session.
    sessionPromise = null;
    throw err;
  });

  return sessionPromise;
}

/** Test-only — drop the cached session so the next call rebuilds. */
export function __resetYoloSessionForTesting(): void {
  sessionPromise = null;
}
