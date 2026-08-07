/**
 * The login / register switcher.
 *
 * The active tab renders through a different branch (a gradient) than the
 * inactive one (a plain View), so "which is selected" is structural. Its
 * comment says the active fill is the one accent identical in light and dark,
 * "which is what makes 'you are here' readable before the user has parsed
 * anything else on the card" — a switcher with neither or both marked leaves
 * the user unsure which form they are filling in.
 */
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

import { AuthTabs } from '@/modules/auth/components/auth-tabs';
import { renderScreen } from '../test-utils';

describe('AuthTabs', () => {
  it('offers both destinations', async () => {
    const view = await renderScreen(<AuthTabs active="login" />);

    expect(view.getByText('เข้าสู่ระบบ')).toBeOnTheScreen();
    expect(view.getByText('ลงทะเบียน')).toBeOnTheScreen();
  });

  it('marks exactly the active tab', async () => {
    const view = await renderScreen(<AuthTabs active="login" />);

    expect(view.getByRole('tab', { name: 'เข้าสู่ระบบ' })).toBeSelected();
    expect(view.getByRole('tab', { name: 'ลงทะเบียน' })).not.toBeSelected();
  });

  it('flips with the active prop', async () => {
    const view = await renderScreen(<AuthTabs active="register" />);

    expect(view.getByRole('tab', { name: 'ลงทะเบียน' })).toBeSelected();
    expect(view.getByRole('tab', { name: 'เข้าสู่ระบบ' })).not.toBeSelected();
  });
});
