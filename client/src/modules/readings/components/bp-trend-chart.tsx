/**
 * The systolic/diastolic trend, ported from `client-old/app/(tabs)/history.tsx`.
 *
 * Same chart: two curved area lines, blue for SYS and purple for DIA, a
 * legend above, the latest pair called out in a tinted strip, and a
 * long-press pointer that reads both values at once. `react-native-gifted-charts`
 * and `react-native-svg` were already dependencies of this tree with no
 * importer — this is what they were there for.
 *
 * The chart plots the last seven readings **in the filtered range**, oldest
 * first. Everything that decides *which* readings those are lives in
 * `lib/time-filter.ts` and is unit-tested; this file only draws.
 *
 * `disableScroll` + `adjustToWidth` is the original's choice and worth
 * keeping: seven points fit, and a chart that scrolls horizontally inside a
 * vertically scrolling screen fights the gesture underneath it.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import { Text, View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';

import { ThemedText } from '@/components/themed-text';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { palette, status as statusColor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

import { chartMaxValue } from '../lib/time-filter';
import type { Reading } from '../types';

cssInterop(LinearGradient, { className: 'style' });

const SYS_COLOR = palette.blue;
const DIA_COLOR = statusColor.critical;

export type BPTrendChartProps = {
  /** Oldest first — see `chartSeries` in `lib/time-filter.ts`. */
  readings: Reading[];
};

export function BPTrendChart({ readings }: BPTrendChartProps) {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { scheme } = useColorSchemePreference();
  const isDark = scheme === 'dark';

  // Nothing to draw. The screen renders its own empty state rather than an
  // axis with no line, which reads as "your readings are zero".
  if (readings.length === 0) return null;

  const axisFontSize = Math.round(12 * fontScale);
  const latest = readings.at(-1);

  const systolic = readings.map((reading) => ({
    value: reading.systolic,
    label: shortDate(reading.measuredAt),
  }));
  const diastolic = readings.map((reading) => ({ value: reading.diastolic }));
  const xLabels = readings.map((reading) => shortDate(reading.measuredAt));

  return (
    <View
      className="mx-4 mb-5 overflow-hidden rounded-3xl border shadow-lg"
      style={{ backgroundColor: colors.surface, borderColor: colors.border }}
    >
      <LinearGradient
        colors={isDark ? [colors.surface, colors['surface-muted']] : [colors.surface, colors.surface]}
        className="rounded-3xl p-4"
      >
        <View className="mb-2 flex-row justify-center" style={{ gap: 24 }}>
          <LegendDot color={SYS_COLOR} label="ค่าบน (SYS)" />
          <LegendDot color={DIA_COLOR} label="ค่าล่าง (DIA)" />
        </View>

        {latest ? (
          <View
            testID="history-chart-latest"
            className="mb-3 flex-row items-center justify-between rounded-2xl border px-4 py-3"
            style={{
              backgroundColor: colors['surface-muted'],
              borderColor: colors.border,
            }}
          >
            <View className="flex-1 pr-3">
              <ThemedText type="small">ค่าล่าสุด</ThemedText>
              <ThemedText type="small" weight="regular" themeColor="text-secondary">
                อัปเดตจากการวัดครั้งล่าสุด
              </ThemedText>
            </View>
            <View className="rounded-full px-4 py-2" style={{ backgroundColor: SYS_COLOR }}>
              <ThemedText type="smallBold" style={{ color: '#FFFFFF' }}>
                {`${latest.systolic}/${latest.diastolic}`}
              </ThemedText>
            </View>
          </View>
        ) : null}

        <View className="my-2 overflow-hidden rounded-2xl">
          <LineChart
            data={systolic}
            data2={diastolic}
            height={220}
            maxValue={chartMaxValue(readings)}
            noOfSections={4}
            adjustToWidth
            initialSpacing={18}
            endSpacing={18}
            spacing={36}
            color1={SYS_COLOR}
            color2={DIA_COLOR}
            thickness1={4}
            thickness2={3}
            dataPointsRadius1={5}
            dataPointsRadius2={4}
            dataPointsColor1={SYS_COLOR}
            dataPointsColor2={DIA_COLOR}
            curved
            areaChart
            startFillColor1={SYS_COLOR}
            endFillColor1={SYS_COLOR}
            startOpacity1={0.2}
            endOpacity1={0.03}
            startFillColor2={DIA_COLOR}
            endFillColor2={DIA_COLOR}
            startOpacity2={0.08}
            endOpacity2={0.01}
            rulesColor={colors.border}
            rulesThickness={1}
            xAxisColor={colors.border}
            yAxisColor="transparent"
            xAxisThickness={1}
            yAxisThickness={0}
            yAxisTextStyle={{ color: colors['text-secondary'], fontSize: axisFontSize }}
            xAxisLabelTextStyle={{ color: colors['text-secondary'], fontSize: axisFontSize }}
            xAxisLabelsHeight={26}
            xAxisLabelTexts={xLabels}
            textColor={colors['text-primary']}
            textFontSize={axisFontSize}
            // See the header: a horizontally scrolling chart inside a
            // vertically scrolling screen fights the gesture underneath it.
            disableScroll
            focusEnabled={false}
            pointerConfig={{
              pointerStripUptoDataPoint: true,
              pointerStripColor: colors.border,
              pointerStripWidth: 2,
              radius: 6,
              pointerColor: SYS_COLOR,
              activatePointersOnLongPress: true,
              persistPointer: false,
              autoAdjustPointerLabelPosition: true,
              pointerLabelComponent: (items: { value?: number }[]) => (
                <View
                  className="rounded-2xl border px-3 py-2"
                  style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                >
                  {/*
                    * Stays literal: this size is deliberately one px above
                    * `axisFontSize`, which is a prop handed to the chart
                    * library. A variant would break that relationship, and
                    * the pointer label reading larger than the axis it floats
                    * over is the point.
                    */}
                  <Text
                    className="font-bold"
                    style={{ fontSize: axisFontSize + 1, color: colors['text-primary'] }}
                  >
                    {`SYS ${items[0]?.value ?? '-'} / DIA ${items[1]?.value ?? '-'}`}
                  </Text>
                </View>
              ),
            }}
          />
        </View>
      </LinearGradient>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {

  return (
    <View className="flex-row items-center">
      <View className="mr-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <ThemedText type="small" themeColor="text-secondary">
        {label}
      </ThemedText>
    </View>
  );
}

/** "29/7" — day/month, matching the original's axis labels. */
const shortDate = (date: Date): string => `${date.getDate()}/${date.getMonth() + 1}`;
