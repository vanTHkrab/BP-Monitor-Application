import { OCR_ENGINE_LABELS, OCR_ENGINES, type OcrEngine } from '@/types';
import { useAppStore } from '@/store/use-app-store';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
