import { OCR_ENGINE_LABELS, OCR_ENGINES, type OcrEngine } from '@/types';
import { useAppStore } from '@/store/use-app-store';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * Dev-only segmented control for picking the OCR engine on the camera
 * flow. Hidden behind ``devMode`` in the preferences slice — production
 * users never see it, so the mutation continues to omit ``ocrEngine``
 * and ai-service falls through to its default.
 *
 * Lives in `components/` because it has no remote-system workflow and
 * the camera screen and a future debug screen could both render it.
 */
export function OcrEngineSelector() {
  const devMode = useAppStore((s) => s.devMode);
  const selected = useAppStore((s) => s.selectedOcrEngine);
  const setSelected = useAppStore((s) => s.setSelectedOcrEngine);
  const isDark = useAppStore((s) => s.themePreference === 'dark');

  if (!devMode) return null;

  return (
    <View
      className={
        (isDark
          ? 'bg-slate-800/80 border-slate-600'
          : 'bg-white/90 border-slate-200') +
        ' flex-row rounded-full border p-1 mx-4 mb-3'
      }
    >
      {OCR_ENGINES.map((engine) => {
        const active = engine === selected;
        return (
          <Pressable
            key={engine}
            onPress={() => void setSelected(engine)}
            className={
              'flex-1 items-center rounded-full py-1.5 px-2 ' +
              (active
                ? isDark
                  ? 'bg-sky-700'
                  : 'bg-sky-500'
                : 'bg-transparent')
            }
          >
            <Text
              className={
                'text-xs font-semibold ' +
                (active
                  ? 'text-white'
                  : isDark
                    ? 'text-slate-200'
                    : 'text-slate-700')
              }
              numberOfLines={1}
            >
              {OCR_ENGINE_LABELS[engine]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

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
 * Render shape: `crnn · 419ms · +18MB`.
 */
export function DevMetricsChip({ engine, totalMs, rssDeltaMb }: DevMetricsChipProps) {
  const devMode = useAppStore((s) => s.devMode);
  const isDark = useAppStore((s) => s.themePreference === 'dark');
  if (!devMode || !engine || totalMs == null || rssDeltaMb == null) return null;

  const sign = rssDeltaMb >= 0 ? '+' : '';
  return (
    <View
      className={
        (isDark
          ? 'bg-slate-800/80 border-slate-600'
          : 'bg-slate-100 border-slate-300') +
        ' self-start rounded-full border px-2.5 py-1 mt-2'
      }
    >
      <Text
        className={
          'text-[11px] font-mono ' +
          (isDark ? 'text-slate-200' : 'text-slate-700')
        }
      >
        {OCR_ENGINE_LABELS[engine]} · {Math.round(totalMs)}ms · {sign}
        {rssDeltaMb.toFixed(1)}MB
      </Text>
    </View>
  );
}
