/**
 * About — a static screen, and the test says so.
 *
 * There is no store, no query, and no branch here beyond the dark/light
 * accent colours, so there are no loading, error, or empty states to pin. The
 * render assertion *is* the whole test. Inventing states for it would be the
 * coverage-shaped test this project warns against.
 *
 * What it still protects is real: the feature list and the link list are
 * module-level arrays rendered through `.map`, so a broken key, a dropped
 * entry, or a `ScrollView` that stops mounting its children shows up here.
 */
import AboutScreen from '@/app/about';
import appJson from '../../app.json';

/*
 * `expo-constants` resolves `expoConfig` to null under jest-expo, so the screen
 * would render the `—` fallback and the assertion below would prove nothing.
 * Feeding it the real manifest keeps the test on the wiring — "the screen shows
 * whatever `app.json` says" — rather than on a literal, which is the coupling
 * that let this line sit on 1.0.0 for a whole 1.1.0 release.
 * `notifications-module.test.ts` mocks this module per-file for its own reasons.
 */
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: jest.requireActual('../../app.json').expo },
}));
import { renderScreen } from '../test-utils';

describe('AboutScreen', () => {
  it('renders the app identity and version', async () => {
    const view = await renderScreen(<AboutScreen />);

    expect(view.getByText('BP Mobile')).toBeOnTheScreen();
    // Against the manifest, not a literal. A literal here is what let the
    // screen sit on 1.0.0 through the whole 1.1.0 release with a green suite.
    expect(
      view.getByText(`เวอร์ชัน ${appJson.expo.version}`),
    ).toBeOnTheScreen();
  });

  it('renders every feature in the list', async () => {
    const view = await renderScreen(<AboutScreen />);

    for (const label of [
      'ถ่ายภาพเครื่องวัดความดัน',
      'วิเคราะห์แนวโน้มความดัน',
      'สร้างรายงาน PDF',
      'แจ้งเตือนวัดความดัน',
      'ชุมชนแลกเปลี่ยนความรู้',
    ]) {
      expect(view.getByText(label)).toBeOnTheScreen();
    }
  });

  it('renders every external link row', async () => {
    const view = await renderScreen(<AboutScreen />);

    for (const label of ['นโยบายความเป็นส่วนตัว', 'เงื่อนไขการใช้งาน', 'GitHub Repository']) {
      expect(view.getByText(label)).toBeOnTheScreen();
    }
  });
});
