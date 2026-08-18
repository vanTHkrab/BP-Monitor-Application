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
import { renderScreen } from '../test-utils';

describe('AboutScreen', () => {
  it('renders the app identity and version', async () => {
    const view = await renderScreen(<AboutScreen />);

    expect(view.getByText('BP Mobile')).toBeOnTheScreen();
    expect(view.getByText('เวอร์ชัน 1.0.0')).toBeOnTheScreen();
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
