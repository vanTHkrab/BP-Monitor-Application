/**
 * Help — static content, exactly like `about`.
 *
 * No store, no query, no branch: the file's own docblock says so ("Static
 * content — no store dependency beyond theme/font"). So the render assertion
 * is the whole test, and the part worth asserting is that every FAQ entry
 * makes it to the screen — an FAQ that silently loses its last two entries is
 * the plausible failure here, and it looks fine in a screenshot.
 */
import HelpScreen from '@/app/help';
import { renderScreen } from '../test-utils';

const FAQ_QUESTIONS = [
  'วิธีการถ่ายภาพเครื่องวัดความดัน?',
  'ค่าความดันปกติอยู่ที่เท่าไหร่?',
  'ควรวัดความดันบ่อยแค่ไหน?',
  'ข้อมูลของฉันปลอดภัยหรือไม่?',
];

describe('HelpScreen', () => {
  it('renders the contact channels', async () => {
    const view = await renderScreen(<HelpScreen />);

    expect(view.getByText('support@bpapp.com')).toBeOnTheScreen();
    expect(view.getByText('02-123-4567')).toBeOnTheScreen();
    expect(view.getByText('@bpapp')).toBeOnTheScreen();
  });

  it('renders every FAQ question', async () => {
    const view = await renderScreen(<HelpScreen />);

    for (const question of FAQ_QUESTIONS) {
      expect(view.getByText(question)).toBeOnTheScreen();
    }
  });

  it('offers both developer-contact tiles', async () => {
    const view = await renderScreen(<HelpScreen />);

    expect(view.getByText('ติดต่อผู้พัฒนา')).toBeOnTheScreen();
    expect(view.getByText('ส่งรายงานปัญหา')).toBeOnTheScreen();
  });
});
