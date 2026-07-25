import { OCR_ENGINE_LABELS, OCR_ENGINES, type OcrEngine } from '@/types';
import { useAppStore } from '@/store/use-app-store';
import { logWarn } from '@/store/shared/log';
import {
  DETECTOR_PROVIDERS,
  setDetectorProvider,
  type DetectorProvider,
} from '@/modules/bp-vision';
import { benchmarkDetect } from '@/utils/detect-benchmark';
import { debug } from '@/utils/debug';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Dev-only segmented control for picking the OCR engine on the camera
 * flow. Hidden behind ``devMode`` in the preferences slice — production
 * users never see it, so the mutation continues to omit ``ocrEngine``
 * and ai-service falls through to its default.
 *
 * Layout uses inline ``StyleSheet`` rather than NativeWind classNames.
 * The component renders inside the camera screen's bottom overlay
 * (``LinearGradient`` + absolute positioning) where dynamic className
 * concat (`+` operator) doesn't always survive NativeWind v4's
 * static-extraction pass — symptom: the View mounts but with no styles
 * so it collapses to zero height. Inline styles bypass the whole
 * extraction concern and the chip stays visible in every config.
 */
export function OcrEngineSelector() {
  const devMode = useAppStore((s) => s.devMode);
  const selected = useAppStore((s) => s.selectedOcrEngine);
  const setSelected = useAppStore((s) => s.setSelectedOcrEngine);
  const isDark = useAppStore((s) => s.themePreference === 'dark');

  if (!devMode) return null;

  return (
    <View
      style={[
        selectorStyles.container,
        isDark ? selectorStyles.containerDark : selectorStyles.containerLight,
      ]}
    >
      {OCR_ENGINES.map((engine) => {
        const active = engine === selected;
        const activeBg = isDark ? '#0369A1' : '#0EA5E9'; // sky-700 / sky-500
        return (
          <Pressable
            key={engine}
            onPress={() => void setSelected(engine)}
            style={[
              selectorStyles.pill,
              active ? { backgroundColor: activeBg } : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                selectorStyles.pillLabel,
                {
                  color: active
                    ? '#FFFFFF'
                    : isDark
                      ? '#E2E8F0'
                      : '#334155',
                },
              ]}
            >
              {OCR_ENGINE_LABELS[engine]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const selectorStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: 1,
    padding: 4,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  containerDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.9)', // slate-800/90
    borderColor: '#475569', // slate-600
  },
  containerLight: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: '#E2E8F0', // slate-200
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 8,
    minHeight: 28,
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});

interface DevMetricsChipProps {
  engine: OcrEngine | null | undefined;
  totalMs: number | null | undefined;
  rssDeltaMb: number | null | undefined;
}

/**
 * Compact chip showing per-analysis telemetry on the result UI. Only
 * renders when devMode AND the gateway reply carried both `engine` and
 * `metrics` — otherwise nothing on screen. Hides itself silently in
 * production traffic regardless of devMode (the chip needs real
 * metrics to be useful).
 *
 * Render shape: `crnn · 419ms · +18MB`. Same inline-style rationale
 * as the selector above.
 */
export function DevMetricsChip({
  engine,
  totalMs,
  rssDeltaMb,
}: DevMetricsChipProps) {
  const devMode = useAppStore((s) => s.devMode);
  const isDark = useAppStore((s) => s.themePreference === 'dark');
  if (!devMode || !engine || totalMs == null || rssDeltaMb == null) return null;

  const sign = rssDeltaMb >= 0 ? '+' : '';
  return (
    <View
      style={[
        chipStyles.container,
        isDark ? chipStyles.containerDark : chipStyles.containerLight,
      ]}
    >
      <Text
        style={[
          chipStyles.label,
          { color: isDark ? '#E2E8F0' : '#334155' },
        ]}
      >
        {OCR_ENGINE_LABELS[engine]} · {Math.round(totalMs)}ms · {sign}
        {rssDeltaMb.toFixed(1)}MB
      </Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
  },
  containerDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderColor: '#475569',
  },
  containerLight: {
    backgroundColor: '#F1F5F9', // slate-100
    borderColor: '#CBD5E1', // slate-300
  },
  label: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});

/**
 * Detector input resolutions to compare, largest (model-native) first.
 *
 * The ONNX graph has dynamic spatial axes, so the same model file runs at any
 * of these. 512 is what the OCR read path and the backend both use; the
 * smaller ones exist only to test whether a live framing gate can buy frame
 * rate without losing the small `sys`/`dia`/`pulse` boxes.
 */
const INPUT_SIZES = [512, 384, 320] as const;
type DetectorInputSize = (typeof INPUT_SIZES)[number];

interface DetectBenchmarkChipProps {
  /** Captured photo to benchmark against — `null` disables the control. */
  imageUri: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
}

/**
 * Dev-only trigger for `utils/detect-benchmark.ts`. Measures how fast the
 * on-device YOLO pass runs on *this* device, which is the go / no-go gate
 * for building a realtime CameraX `ImageAnalysis` framing gate: below
 * ~4 fps a live "monitor detected" signal lags the user's hand enough to
 * mislead, and the auto-capture design that sits on top of it stops being
 * trustworthy.
 *
 * Runs against an already-captured photo rather than the live preview so
 * it needs no native changes at all — that's the whole point of measuring
 * before writing any Kotlin.
 *
 * Gated on `__DEV__`, deliberately NOT on `devMode` like the two controls
 * above. `devMode` is a hidden 7-tap gesture whose purpose is letting the
 * team switch OCR engines on a *shipped* build during a demo; this is a
 * build-time measurement instrument for a one-off engineering decision and
 * has no business being reachable in a release build at all. `__DEV__` is
 * false in production bundles, so this cannot ship even by accident —
 * strictly tighter than `devMode`, which can be switched on in production.
 *
 * Same inline-style rationale as the components above.
 */
export function DetectBenchmarkChip({
  imageUri,
  sourceWidth,
  sourceHeight,
}: DetectBenchmarkChipProps) {
  const isDark = useAppStore((s) => s.themePreference === 'dark');
  const [running, setRunning] = React.useState(false);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [provider, setProvider] = React.useState<DetectorProvider>('CPU');
  const [inputSize, setInputSize] = React.useState<DetectorInputSize>(INPUT_SIZES[0]);

  if (!__DEV__ || !imageUri || sourceWidth == null || sourceHeight == null) {
    return null;
  }

  // Cycle CPU -> XNNPACK -> NNAPI -> CPU. Switching closes the current ONNX
  // session so the next detect call rebuilds on the chosen backend; the
  // benchmark's own warmup absorbs that rebuild, which is why the warmup
  // figure is reported separately from the per-frame median.
  const cycleProvider = async () => {
    if (running) return;
    const next =
      DETECTOR_PROVIDERS[
        (DETECTOR_PROVIDERS.indexOf(provider) + 1) % DETECTOR_PROVIDERS.length
      ];
    const applied = await setDetectorProvider(next);
    setProvider(next);
    setSummary(null);
    debug.info('[DetectBenchmark] provider switched to', applied ?? 'unavailable');
  };

  const run = async () => {
    if (running) return;
    setRunning(true);
    setSummary(null);
    try {
      const result = await benchmarkDetect(
        imageUri,
        sourceWidth,
        sourceHeight,
        30,
        inputSize,
      );
      if (!result) {
        // iOS / web / Expo Go — the native module isn't linked at all.
        setSummary('bp-vision unavailable');
        debug.warn('[DetectBenchmark] bp-vision native module unavailable');
        return;
      }
      setSummary(
        `${result.estimatedFps.toFixed(1)} fps · med ${result.medianMs}ms · ` +
          `p90 ${result.p90Ms}ms · ${result.detectionCount}/5 det\n` +
          result.classes.join(' '),
      );
      // Also dump to the Metro console: the chip lives inside a camera
      // overlay that other chrome can cover, and this number is the input
      // to a real go / no-go decision — it should not be readable only
      // through a UI surface that might be obscured.
      debug.info('[DetectBenchmark]', {
        provider,
        inputSize: result.inputSize,
        estimatedFps: Number(result.estimatedFps.toFixed(2)),
        medianMs: result.medianMs,
        p90Ms: result.p90Ms,
        minMs: result.minMs,
        maxMs: result.maxMs,
        warmupMs: result.warmupMs,
        runs: result.runs,
        detectionCount: result.detectionCount,
        classes: result.classes,
        sourceWidth,
        sourceHeight,
      });
    } catch (error) {
      logWarn('DetectBenchmark', 'benchmark run failed', error);
      setSummary('benchmark failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={benchmarkStyles.wrapper}>
      <Pressable
        onPress={() => void run()}
        disabled={running}
        accessibilityRole="button"
        accessibilityLabel="วัดความเร็วการตรวจจับบนเครื่อง"
        style={[
          benchmarkStyles.button,
          isDark
            ? benchmarkStyles.buttonDark
            : benchmarkStyles.buttonLight,
        ]}
      >
        {running ? (
          <ActivityIndicator size="small" color={isDark ? '#E2E8F0' : '#334155'} />
        ) : (
          <Text
            style={[
              benchmarkStyles.buttonLabel,
              { color: isDark ? '#E2E8F0' : '#334155' },
            ]}
          >
            ⏱ bench ×30 · {provider} · {inputSize}
          </Text>
        )}
      </Pressable>
      <Pressable
        onPress={() => void cycleProvider()}
        disabled={running}
        accessibilityRole="button"
        accessibilityLabel="สลับ ONNX execution provider"
        style={[
          benchmarkStyles.button,
          benchmarkStyles.providerButton,
          isDark ? benchmarkStyles.buttonDark : benchmarkStyles.buttonLight,
        ]}
      >
        <Text
          style={[
            benchmarkStyles.buttonLabel,
            { color: isDark ? '#E2E8F0' : '#334155' },
          ]}
        >
          ⇄ provider
        </Text>
      </Pressable>
      <Pressable
        onPress={() => {
          if (running) return;
          setInputSize(
            INPUT_SIZES[(INPUT_SIZES.indexOf(inputSize) + 1) % INPUT_SIZES.length],
          );
          setSummary(null);
        }}
        disabled={running}
        accessibilityRole="button"
        accessibilityLabel="สลับความละเอียด input ของตัวตรวจจับ"
        style={[
          benchmarkStyles.button,
          benchmarkStyles.providerButton,
          isDark ? benchmarkStyles.buttonDark : benchmarkStyles.buttonLight,
        ]}
      >
        <Text
          style={[
            benchmarkStyles.buttonLabel,
            { color: isDark ? '#E2E8F0' : '#334155' },
          ]}
        >
          ⇄ input {inputSize}
        </Text>
      </Pressable>
      {summary ? (
        <View
          style={[
            chipStyles.container,
            isDark ? chipStyles.containerDark : chipStyles.containerLight,
          ]}
        >
          <Text style={[chipStyles.label, { color: isDark ? '#E2E8F0' : '#334155' }]}>
            {summary}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const benchmarkStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    marginTop: 8,
  },
  button: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 30,
    minWidth: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderColor: '#475569',
  },
  buttonLight: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: '#CBD5E1',
  },
  providerButton: {
    marginTop: 6,
    minWidth: 110,
  },
  buttonLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});
