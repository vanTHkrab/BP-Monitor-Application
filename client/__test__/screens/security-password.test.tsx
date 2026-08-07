/**
 * Change password.
 *
 * This screen has no loading, error, or empty state on render. Every state it
 * has — field-level validation errors, the success banner, the wrong-password
 * banner — is produced by submitting the form, which is an interaction test
 * and deliberately out of scope for this batch. So the render assertion is
 * the whole test here, and inventing a state for it would be dishonest.
 *
 * What the render assertion does protect is not nothing: the length floor is
 * stated *before* a failure rather than after one, and the screen warns up
 * front that changing the password signs other devices out. Both are copy
 * that a redesign silently drops, and both are the difference between an
 * expected consequence and a surprise.
 *
 * The pending state is the one branch reachable without interacting, so it is
 * asserted through the hook.
 */
const mockChangePassword = {
  current: { changePassword: jest.fn(), isPending: false },
};
jest.mock('@/modules/auth', () => ({
  ...jest.requireActual('@/modules/auth'),
  useChangePassword: () => mockChangePassword.current,
}));

jest.mock('@/modules/security', () => ({
  ...jest.requireActual('@/modules/security'),
  SecurityHeader: () => null,
}));

import ChangePasswordScreen from '@/app/security/password';
import { renderScreen } from '../test-utils';

beforeEach(() => {
  jest.clearAllMocks();
  mockChangePassword.current = { changePassword: jest.fn(), isPending: false };
});

describe('ChangePasswordScreen', () => {
  it('renders all three fields and the submit action', async () => {
    const view = await renderScreen(<ChangePasswordScreen />);

    expect(view.getByTestId('password-current')).toBeOnTheScreen();
    expect(view.getByTestId('password-new')).toBeOnTheScreen();
    expect(view.getByTestId('password-confirm')).toBeOnTheScreen();
    expect(view.getByTestId('password-submit')).toBeOnTheScreen();
  });

  /*
   * Stated before the attempt, not after it. A minimum length discovered only
   * by failing is a round trip the user pays for with a rejected form, and
   * `MIN_PASSWORD_LENGTH` matches the gateway's floor — so the number here is
   * a contract, not decoration.
   */
  it('states the length floor and the sign-out consequence up front', async () => {
    const view = await renderScreen(<ChangePasswordScreen />);

    expect(view.getByText(/ตั้งรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร/)).toBeOnTheScreen();
    expect(view.getByText(/อุปกรณ์เครื่องอื่นจะถูกออกจากระบบ/)).toBeOnTheScreen();
  });

  it('renders no banner before anything has been submitted', async () => {
    const view = await renderScreen(<ChangePasswordScreen />);

    expect(view.queryByText(/เปลี่ยนรหัสผ่านเรียบร้อยแล้ว/)).toBeNull();
    expect(view.queryByText(/เปลี่ยนรหัสผ่านไม่สำเร็จ/)).toBeNull();
  });

  // Blocks a second submit while the first is in flight — two password
  // changes racing is one of them failing against a password that no longer
  // exists.
  it('blocks the submit action while a change is in flight', async () => {
    mockChangePassword.current.isPending = true;
    const view = await renderScreen(<ChangePasswordScreen />);

    expect(view.getByTestId('password-submit')).toBeDisabled();
  });
});
