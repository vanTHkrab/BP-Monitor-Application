/**
 * The systolic/diastolic trend.
 *
 * The one branch worth a test is the guard at the top: `readings.length === 0`
 * returns `null`, because an axis with no line reads as "your readings are
 * zero" — on a blood-pressure app, to an elderly patient, that is a
 * frightening thing to render by accident. The screen owns the empty state.
 *
 * Everything that decides *which* readings reach here lives in
 * `lib/time-filter.ts` and is unit-tested there; this file only draws. So what
 * is left is the series it hands the chart, and the callout strip — the one
 * part of the chart that is text rather than geometry.
 *
 * ## Why `LineChart` is mocked
 *
 * Not for isolation — for containment. Rendering the real `LineChart` mounts
 * an animation that calls `setTimeout` and then reaches for `Animated.timing`,
 * which `jest.setup.js`'s hand-written reanimated stub does not provide. The
 * timer outlives this suite's cleanup and fires during **whichever file runs
 * next**, so the failure lands in an unrelated test — it surfaced in
 * `haptic-tab.test.tsx` as `Cannot read properties of undefined (reading
 * 'timing')` from a chart that file never imports, and `pnpm test` went red on
 * a suite that was correct.
 *
 * `__test__/screens/history.test.tsx` mocks the same module for its own
 * reason. Two consumers, so the stub stays per-file — a shared one could
 * satisfy that file's `data` assertion by accident.
 */
const mockChart = { current: null as Record<string, unknown> | null };
jest.mock('react-native-gifted-charts', () => ({
  LineChart: (props: Record<string, unknown>) => {
    mockChart.current = props;
    return null;
  },
}));

import { BPTrendChart } from '@/modules/readings/components/bp-trend-chart';
import type { Reading } from '@/modules/readings/types';
import { renderScreen } from '../test-utils';

const reading = (overrides: Partial<Reading> = {}): Reading => ({
  key: 'r1',
  userId: 'u1',
  systolic: 120,
  diastolic: 78,
  pulse: 70,
  measuredAt: new Date('2026-08-01T09:00:00+07:00'),
  status: 'normal',
  createdAt: new Date('2026-08-01T09:00:00+07:00'),
  syncState: 'synced',
  ...overrides,
});

const series = [
  reading({ key: 'a', systolic: 110, diastolic: 70 }),
  reading({ key: 'b', systolic: 118, diastolic: 74, measuredAt: new Date('2026-08-03T09:00:00+07:00') }),
  reading({ key: 'c', systolic: 145, diastolic: 92, measuredAt: new Date('2026-08-05T09:00:00+07:00') }),
];

beforeEach(() => {
  mockChart.current = null;
});

describe('BPTrendChart', () => {
  // Not "renders an empty state" — it renders *nothing*, and the difference
  // matters because the screen draws its own empty state in this slot.
  it('draws nothing at all when there is nothing to plot', async () => {
    const view = await renderScreen(<BPTrendChart readings={[]} />);

    // `toJSON()` is the provider wrapper `renderScreen` mounts, never null —
    // so what is asserted is that the wrapper has no children, which is the
    // component contributing nothing to the tree.
    expect((view.toJSON() as { children?: unknown[] | null }).children ?? []).toHaveLength(0);
    expect(mockChart.current).toBeNull();
  });

  it('draws once there is a reading', async () => {
    const view = await renderScreen(<BPTrendChart readings={[reading()]} />);

    expect((view.toJSON() as { children?: unknown[] | null }).children ?? []).not.toHaveLength(0);
    expect(mockChart.current).not.toBeNull();
  });

  /*
   * Both series reach the chart, in the order they were handed in. `data` is
   * systolic and `data2` is diastolic; swapping them draws the pair inverted,
   * which on a BP chart is a clinically wrong picture that still looks like a
   * working chart.
   */
  it('hands the chart both series, oldest first', async () => {
    await renderScreen(<BPTrendChart readings={series} />);

    expect((mockChart.current?.data as { value: number }[]).map((point) => point.value)).toEqual([
      110, 118, 145,
    ]);
    expect((mockChart.current?.data2 as { value: number }[]).map((point) => point.value)).toEqual([
      70, 74, 92,
    ]);
  });

  /*
   * The callout reports the *last* entry, and the contract on the prop is
   * "oldest first". Reading `readings[0]` instead would put the oldest
   * measurement in the "latest" strip — a wrong number rendered confidently,
   * which is worse on this screen than a missing one.
   */
  it('calls out the newest pair, not the oldest', async () => {
    const view = await renderScreen(<BPTrendChart readings={series} />);

    expect(view.getByText(/145/)).toBeOnTheScreen();
    expect(view.queryByText(/110/)).toBeNull();
  });

  it('labels both series so the two lines are tellable apart', async () => {
    const view = await renderScreen(<BPTrendChart readings={[reading()]} />);

    expect(view.getByText('ค่าบน (SYS)')).toBeOnTheScreen();
    expect(view.getByText('ค่าล่าง (DIA)')).toBeOnTheScreen();
  });
});
