/**
 * "เช็กรอบวัดของวันนี้" — the strip that tells a patient which of today's
 * reminder rounds they have answered.
 *
 * This is the highest-value card in the batch because it is the only place in
 * the app where a *wrong* render is worse than no render: the three statuses
 * are green / red / neutral, and a round shown red that was actually answered
 * tells a patient they missed a measurement they took. `reminder-timeline.ts`
 * is separately tested as pure logic; nothing asserted that the card puts the
 * right status on the right round, or that the empty state exists at all.
 *
 * Four things are pinned here:
 *
 *   - the per-status branch (`completed` / `missed` / `upcoming`), through the
 *     detail copy and the accessibility label, which is what a screen reader
 *     gets instead of the colour;
 *   - the `สำเร็จ n/m` counter, the only aggregate on screen;
 *   - the empty state, which replaces both the legend and the strip;
 *   - the invariant the component's own comment claims — that green and red
 *     keep their tint in dark mode and only `upcoming` goes neutral.
 *
 * `now` is injected (the component takes it for exactly this reason), so none
 * of it races the wall clock.
 */
import type { ColorSchemePreference } from '@/theme/color-scheme';

/*
 * The scheme is provider state with no setter reachable from a render-only
 * test, so the hook is replaced the way `theme-picker.test.tsx` replaces it.
 * `requireActual` keeps `ColorSchemeProvider` real because `test-utils` mounts
 * it, and the stub returns the whole context shape because `useTheme()` reads
 * `scheme` off this same hook — a stub missing it makes every colour in the
 * tree `undefined`, which fails somewhere other than here.
 */
const mockScheme = {
  current: {
    preference: 'system' as ColorSchemePreference,
    scheme: 'light' as 'light' | 'dark',
    setPreference: jest.fn(),
    hydrated: true,
  },
};

jest.mock('@/theme/color-scheme', () => ({
  ...jest.requireActual('@/theme/color-scheme'),
  useColorSchemePreference: () => mockScheme.current,
}));

import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ReminderTimelineCard } from '@/modules/notifications/components/reminder-timeline-card';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '@/modules/notifications/types';

import { renderScreen, within } from '../test-utils';

/**
 * 08:00 / 12:00 / 16:00 on Thursday 15 January 2026, every weekday selected so
 * the fixture does not depend on which day the date lands on. Built with the
 * local-time `Date` constructor because every hour comparison in
 * `reminder-timeline.ts` is local wall-clock.
 */
const SETTINGS: ReminderSettings = {
  ...DEFAULT_REMINDER_SETTINGS,
  enabled: true,
  reminderTimes: [{ hour: 8, minute: 0 }, { hour: 12, minute: 0 }, { hour: 16, minute: 0 }],
  selectedDays: [0, 1, 2, 3, 4, 5, 6],
};

const at = (hour: number, minute = 0) => new Date(2026, 0, 15, hour, minute, 0, 0);

/** 13:00 — 08:00 is past, 12:00 is past, 16:00 is still ahead. */
const NOW = at(13);

const ROUND_0800 = 'reminder-round-2026-01-15:08:00';
const ROUND_1200 = 'reminder-round-2026-01-15:12:00';
const ROUND_1600 = 'reminder-round-2026-01-15:16:00';

/**
 * `props.style` on these cards is an array — NativeWind's compiled className
 * plus the inline object — so it has to be flattened before a colour can be
 * read off it. Returning `undefined` rather than throwing would give a test
 * that compares `undefined` to `undefined` and can never fail, so the caller
 * asserts the value is defined first.
 */
const backgroundOf = (node: { props: Record<string, unknown> }): string | undefined =>
  (StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}).backgroundColor as
    | string
    | undefined;

function setScheme(scheme: 'light' | 'dark') {
  mockScheme.current = { ...mockScheme.current, scheme };
}

beforeEach(() => {
  setScheme('light');
});

describe('ReminderTimelineCard', () => {
  it('renders one card per planned round', async () => {
    const view = await renderScreen(
      <ReminderTimelineCard settings={SETTINGS} readings={[]} now={NOW} />,
    );

    expect(view.getByTestId('reminder-timeline')).toBeOnTheScreen();
    expect(view.getByTestId(ROUND_0800)).toBeOnTheScreen();
    expect(view.getByTestId(ROUND_1200)).toBeOnTheScreen();
    expect(view.getByTestId(ROUND_1600)).toBeOnTheScreen();
    expect(view.queryByTestId('reminder-timeline-empty')).toBeNull();
  });

  /*
   * The three status branches in one render, read through the detail copy
   * rather than the fill: the colour is the fast signal but the sentence is
   * what a patient reads to find out *why* a round is red, and it is the only
   * part of the status a screen reader ever reaches.
   *
   * `within(...)` rather than `toHaveTextContent` on the card: each card also
   * holds an Ionicons glyph, which renders as invisible text inside the same
   * container and makes an aggregated-text match fail against a string a human
   * would call correct.
   */
  it('labels a measured round, an unanswered one, and one still ahead differently', async () => {
    const view = await renderScreen(
      <ReminderTimelineCard
        settings={SETTINGS}
        readings={[{ key: 'r1', measuredAt: at(8, 30) }]}
        now={NOW}
      />,
    );

    expect(within(view.getByTestId(ROUND_0800)).getByText('วัด 30 นาทีหลังเตือน')).toBeOnTheScreen();
    expect(within(view.getByTestId(ROUND_1200)).getByText('ยังไม่ได้วัด')).toBeOnTheScreen();
    expect(within(view.getByTestId(ROUND_1600)).getByText('รอถึงเวลา')).toBeOnTheScreen();
  });

  // The lateness is only rendered when it is non-zero. A reading taken on the
  // hour would otherwise read "วัด 0 นาทีหลังเตือน", which sounds like a
  // reproach for being punctual.
  it('says a round was answered on time rather than reporting zero minutes late', async () => {
    const view = await renderScreen(
      <ReminderTimelineCard
        settings={SETTINGS}
        readings={[{ key: 'r1', measuredAt: at(8) }]}
        now={NOW}
      />,
    );

    expect(within(view.getByTestId(ROUND_0800)).getByText('วัดตรงรอบแล้ว')).toBeOnTheScreen();
  });

  // The colour and the icon carry the status visually; this label is the whole
  // of it for anyone using a screen reader.
  it('puts the round and its outcome in the accessibility label', async () => {
    const view = await renderScreen(
      <ReminderTimelineCard
        settings={SETTINGS}
        readings={[{ key: 'r1', measuredAt: at(8, 30) }]}
        now={NOW}
      />,
    );

    expect(view.getByTestId(ROUND_0800)).toHaveProp(
      'accessibilityLabel',
      'รอบ 08:00 วัด 30 นาทีหลังเตือน',
    );
    expect(view.getByTestId(ROUND_1200)).toHaveProp('accessibilityLabel', 'รอบ 12:00 ยังไม่ได้วัด');
    expect(view.getByTestId(ROUND_1600)).toHaveProp('accessibilityLabel', 'รอบ 16:00 รอถึงเวลา');
  });

  // Only a completed round has a measurement time to show, so the line is
  // present on exactly one of the three cards.
  it('shows the measurement time only on the round that has one', async () => {
    const view = await renderScreen(
      <ReminderTimelineCard
        settings={SETTINGS}
        readings={[{ key: 'r1', measuredAt: at(8, 5) }]}
        now={NOW}
      />,
    );

    expect(within(view.getByTestId(ROUND_0800)).getByText('เวลา 08:05 น.')).toBeOnTheScreen();
    // Anchored: the `upcoming` detail copy is "รอถึงเวลา", which contains
    // "เวลา" as a substring and matched an unanchored pattern.
    expect(within(view.getByTestId(ROUND_1200)).queryByText(/^เวลา /)).toBeNull();
    expect(within(view.getByTestId(ROUND_1600)).queryByText(/^เวลา /)).toBeNull();
  });

  it('counts the answered rounds against the day', async () => {
    const view = await renderScreen(
      <ReminderTimelineCard
        settings={SETTINGS}
        readings={[{ key: 'r1', measuredAt: at(8, 30) }]}
        now={NOW}
      />,
    );

    expect(
      within(view.getByTestId('reminder-timeline-progress')).getByText('สำเร็จ 1/3'),
    ).toBeOnTheScreen();
    expect(view.getByText('วัดแล้ว 1')).toBeOnTheScreen();
    expect(view.getByText('ค้างวัด 1')).toBeOnTheScreen();
  });

  /*
   * Reminders off is one of three inputs that produce no rounds — the others
   * are no selected weekday and a settings window that yields no hours.
   * `buildReminderTimeline` deliberately does not distinguish them, because
   * all three are answered by opening reminder settings, so the card has one
   * empty state and this covers it.
   */
  describe('with no rounds today', () => {
    const OFF: ReminderSettings = { ...SETTINGS, enabled: false };

    it('replaces the strip with an explanation', async () => {
      const view = await renderScreen(
        <ReminderTimelineCard settings={OFF} readings={[]} now={NOW} />,
      );

      expect(view.getByTestId('reminder-timeline-empty')).toBeOnTheScreen();
      expect(view.getByText('วันนี้ยังไม่มีรอบแจ้งเตือน')).toBeOnTheScreen();
      expect(view.queryByTestId(ROUND_0800)).toBeNull();
    });

    // The legend explains a colour coding that is not on screen in this
    // branch. Rendering it anyway would offer a key to nothing.
    it('drops the legend along with the strip', async () => {
      const view = await renderScreen(
        <ReminderTimelineCard settings={OFF} readings={[]} now={NOW} />,
      );

      expect(view.queryByText('ยังไม่ถึงเวลา')).toBeNull();
      expect(view.queryByText('วัดแล้ว 0')).toBeNull();
    });

    // The heading and its counter stay, so the section does not look broken.
    it('keeps the counter, reading zero of zero', async () => {
      const view = await renderScreen(
        <ReminderTimelineCard settings={OFF} readings={[]} now={NOW} />,
      );

      expect(
        within(view.getByTestId('reminder-timeline-progress')).getByText('สำเร็จ 0/0'),
      ).toBeOnTheScreen();
    });
  });

  /*
   * The invariant the component's own comment claims: "green means done and
   * red means not, and a theme must not be able to soften that". Only
   * `upcoming` is allowed a dark treatment.
   *
   * Colour is the one thing here that no text assertion can reach, so this
   * reads `style` — and it reads it from a flattened array, because
   * `ThemedText`-adjacent NativeWind classes turn `props.style` into one. The
   * light-mode values are asserted as literals first so that the dark-mode
   * "unchanged" claim is anchored to a known value rather than to whatever
   * both renders happen to produce.
   */
  describe('dark mode', () => {
    const readings = [{ key: 'r1', measuredAt: at(8, 30) }];

    it('keeps completed green and missed red', async () => {
      setScheme('light');
      const light = await renderScreen(
        <ReminderTimelineCard settings={SETTINGS} readings={readings} now={NOW} />,
      );
      expect(backgroundOf(light.getByTestId(ROUND_0800))).toBe('#DCFCE7');
      expect(backgroundOf(light.getByTestId(ROUND_1200))).toBe('#FEE2E2');

      setScheme('dark');
      const dark = await renderScreen(
        <ReminderTimelineCard settings={SETTINGS} readings={readings} now={NOW} />,
      );
      expect(backgroundOf(dark.getByTestId(ROUND_0800))).toBe('#DCFCE7');
      expect(backgroundOf(dark.getByTestId(ROUND_1200))).toBe('#FEE2E2');
    });

    it('neutralises only the upcoming round', async () => {
      setScheme('light');
      const light = await renderScreen(
        <ReminderTimelineCard settings={SETTINGS} readings={readings} now={NOW} />,
      );
      expect(backgroundOf(light.getByTestId(ROUND_1600))).toBe('#EFF6FF');

      setScheme('dark');
      const dark = await renderScreen(
        <ReminderTimelineCard settings={SETTINGS} readings={readings} now={NOW} />,
      );
      const darkUpcoming = backgroundOf(dark.getByTestId(ROUND_1600));
      // Defined-first: comparing two `undefined`s would pass forever.
      expect(darkUpcoming).toBeDefined();
      expect(darkUpcoming).not.toBe('#EFF6FF');
    });
  });
});
