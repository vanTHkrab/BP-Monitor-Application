/**
 * The app-lock toggle.
 *
 * No query here, so no loading or error state on render — the error state is
 * a `message` set by the toggle handler, which is an interaction and out of
 * scope for this batch. What *is* pure render state is the capability gate,
 * and it is the part that matters: a switch offered on a phone with no PIN,
 * fingerprint, or face unlock configured cannot be satisfied, and the screen
 * has to say why rather than just refusing.
 *
 * The asymmetry in `disabled={!available && !isOn}` is the assertion worth
 * having. Someone who enabled the lock and then removed their device unlock
 * must still be able to turn it *off* — the opposite would leave them locked
 * out of their own readings with no way back, which is the failure the
 * handler's own comment says the enable path exists to prevent.
 */
const mockAppLock = {
  current: {
    enabled: false as boolean | null,
    capability: { available: true, label: 'ลายนิ้วมือ' } as Record<string, unknown> | null,
    setEnabled: jest.fn(),
  },
};
jest.mock('@/modules/security', () => ({
  ...jest.requireActual('@/modules/security'),
  SecurityHeader: () => null,
  useAppLock: () => mockAppLock.current,
}));

import AppLockScreen from '@/app/security/app-lock';
import { renderScreen } from '../test-utils';

beforeEach(() => {
  jest.clearAllMocks();
  mockAppLock.current = {
    enabled: false,
    capability: { available: true, label: 'ลายนิ้วมือ' },
    setEnabled: jest.fn(),
  };
});

describe('AppLockScreen', () => {
  it('explains what the lock is for before offering it', async () => {
    const view = await renderScreen(<AppLockScreen />);

    expect(view.getByText('ให้ถามก่อนเปิดแอปทุกครั้ง')).toBeOnTheScreen();
    expect(view.getByTestId('app-lock-toggle')).toBeOnTheScreen();
  });

  it('reports the lock as off when it is off', async () => {
    const view = await renderScreen(<AppLockScreen />);

    expect(view.getByTestId('app-lock-toggle')).toHaveTextContent(/ปิดอยู่/);
  });

  it('reports the lock as on when it is on', async () => {
    mockAppLock.current.enabled = true;
    const view = await renderScreen(<AppLockScreen />);

    expect(view.getByTestId('app-lock-toggle')).toHaveTextContent(/เปิดอยู่/);
  });

  // Names the method the device actually offers. "ปลดล็อกด้วยระบบล็อกหน้าจอ"
  // is the fallback, not the normal case.
  it('names the unlock method the device supports', async () => {
    const view = await renderScreen(<AppLockScreen />);

    expect(view.getByTestId('app-lock-toggle')).toHaveTextContent(/ปลดล็อกด้วยลายนิ้วมือ/);
  });

  describe('when the device has no unlock configured', () => {
    it('says why instead of silently refusing', async () => {
      mockAppLock.current.capability = { available: false, label: null };
      const view = await renderScreen(<AppLockScreen />);

      expect(view.getByTestId('app-lock-toggle')).toHaveTextContent(
        /ต้องตั้งค่าการปลดล็อกในเครื่องก่อน/,
      );
    });

    /*
     * Asserted on the `disabled` prop rather than with `toBeDisabled()`. That
     * matcher reads `accessibilityState.disabled`, which React Native's
     * `Switch` never sets — so it reports *every* switch as enabled, and the
     * negative form of this assertion passes whether or not the screen works.
     * That is the "test that cannot fail" this file exists to avoid.
     */
    it('disables the switch so it cannot be turned on', async () => {
      mockAppLock.current.capability = { available: false, label: null };
      const view = await renderScreen(<AppLockScreen />);

      expect(view.getByLabelText('เปิดหรือปิดการล็อกแอป').props.disabled).toBe(true);
    });

    /*
     * The regression this guards: a lock that is already on must stay
     * switchable off even after the device unlock is removed, or the user is
     * shut out of their own readings with no route back through the app.
     */
    it('leaves the switch usable when the lock is already on', async () => {
      mockAppLock.current = {
        enabled: true,
        capability: { available: false, label: null },
        setEnabled: jest.fn(),
      };
      const view = await renderScreen(<AppLockScreen />);

      expect(view.getByLabelText('เปิดหรือปิดการล็อกแอป').props.disabled).toBe(false);
    });
  });

  // The lock is device-local. Someone who turns it on and thinks their
  // account is now protected everywhere has been misled by the screen.
  it('states that the lock does not protect other devices', async () => {
    const view = await renderScreen(<AppLockScreen />);

    expect(view.getByText(/ล็อกแอปทำงานบนเครื่องนี้เท่านั้น/)).toBeOnTheScreen();
  });
});
