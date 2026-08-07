/**
 * Passkeys.
 *
 * The whole screen turns on a two-sided gate — the device must support
 * passkeys *and* the server must have them enabled — and the screen's own
 * comment says why the distinction matters: "ไม่รองรับ" alone leaves the user
 * trying to fix a phone that is fine. So the assertions are that the add
 * button is disabled when either side is missing, and that the explanation
 * names the side that is actually missing.
 *
 * The second thing worth pinning is the backed-up hint on each row. A passkey
 * that lives only on this device disappears with the device, and that is
 * exactly the thing someone needs to know *before* they delete their
 * password — a row that reports the wrong one is a lockout waiting to happen.
 *
 * `isPasskeyAvailableOnDevice` is a device capability check, so it is mocked
 * per-value; everything else in the security module stays real.
 */
const mockDeviceSupported = { current: true };
const mockOverview = { current: null as Record<string, unknown> | null };
const mockPasskeys = {
  current: {
    passkeys: [] as Record<string, unknown>[],
    isLoading: false,
    refetch: jest.fn(),
  },
};

jest.mock('@/modules/security', () => ({
  ...jest.requireActual('@/modules/security'),
  SecurityHeader: () => null,
  isPasskeyAvailableOnDevice: () => mockDeviceSupported.current,
  useSecurityOverview: () => ({ overview: mockOverview.current }),
  usePasskeys: () => mockPasskeys.current,
  useRegisterPasskey: () => ({ registerPasskey: jest.fn(), isPending: false }),
  useDeletePasskey: () => ({ deletePasskey: jest.fn() }),
}));

import PasskeysScreen from '@/app/security/passkeys';
import { renderScreen } from '../test-utils';

const passkey = (over: Record<string, unknown> = {}) => ({
  id: 'pk1',
  name: 'Android App',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  backedUp: true,
  ...over,
});

const DEVICE_UNSUPPORTED =
  'เครื่องนี้ยังใช้ Passkey ไม่ได้ ลองตั้งค่าการปลดล็อกหน้าจอ (PIN, ลายนิ้วมือ หรือใบหน้า) ในการตั้งค่าของเครื่องก่อน';
const SERVER_UNSUPPORTED = 'ระบบยังไม่เปิดใช้งาน Passkey สำหรับเซิร์ฟเวอร์นี้';

beforeEach(() => {
  jest.clearAllMocks();
  mockDeviceSupported.current = true;
  mockOverview.current = { passkeySupported: true };
  mockPasskeys.current = { passkeys: [], isLoading: false, refetch: jest.fn() };
});

describe('PasskeysScreen — the empty state', () => {
  /*
   * There is no separate empty component: the list group is simply not
   * rendered, and the explainer plus the add button carry the screen. Pinned
   * so a future "no passkeys yet" card does not quietly replace the
   * explanation of what a passkey even is.
   */
  it('explains passkeys and offers to add one when there are none', async () => {
    const view = await renderScreen(<PasskeysScreen />);

    expect(view.getByText('เข้าสู่ระบบด้วยลายนิ้วมือหรือใบหน้า')).toBeOnTheScreen();
    expect(view.getByTestId('passkey-add')).toBeOnTheScreen();
    expect(view.queryByText('ที่เพิ่มไว้แล้ว')).toBeNull();
  });
});

describe('PasskeysScreen — the list', () => {
  it('lists each registered passkey', async () => {
    mockPasskeys.current.passkeys = [passkey(), passkey({ id: 'pk2', name: 'Pixel 8' })];
    const view = await renderScreen(<PasskeysScreen />);

    expect(view.getByTestId('passkey-pk1')).toBeOnTheScreen();
    expect(view.getByTestId('passkey-pk2')).toBeOnTheScreen();
  });

  // The API leaves the name optional; a nameless row is not a row anyone can
  // tell apart from a rendering bug.
  it('falls back to a label for an unnamed passkey', async () => {
    mockPasskeys.current.passkeys = [passkey({ name: null })];
    const view = await renderScreen(<PasskeysScreen />);

    expect(view.getByTestId('passkey-pk1')).toHaveTextContent(/Passkey/);
  });

  /*
   * The hint someone reads before deciding whether they still need a
   * password. Getting this backwards is a lockout: a device-only passkey
   * reported as backed up survives right up until the phone is lost.
   */
  it('says a backed-up passkey works from other devices', async () => {
    mockPasskeys.current.passkeys = [passkey({ backedUp: true })];
    const view = await renderScreen(<PasskeysScreen />);

    expect(view.getByTestId('passkey-pk1')).toHaveTextContent(
      /สำรองไว้กับบัญชีแล้ว ใช้ได้จากเครื่องอื่นของคุณ/,
    );
  });

  it('warns that a device-only passkey is lost with the device', async () => {
    mockPasskeys.current.passkeys = [passkey({ backedUp: false })];
    const view = await renderScreen(<PasskeysScreen />);

    expect(view.getByTestId('passkey-pk1')).toHaveTextContent(
      /อยู่บนเครื่องนี้เท่านั้น ถ้าเครื่องหายจะใช้ไม่ได้/,
    );
  });
});

describe('PasskeysScreen — the two-sided support gate', () => {
  it('offers the add button when both sides support passkeys', async () => {
    const view = await renderScreen(<PasskeysScreen />);

    expect(view.getByTestId('passkey-add')).not.toBeDisabled();
    expect(view.queryByText(DEVICE_UNSUPPORTED)).toBeNull();
    expect(view.queryByText(SERVER_UNSUPPORTED)).toBeNull();
  });

  it('blames the device when the device is the missing side', async () => {
    mockDeviceSupported.current = false;
    const view = await renderScreen(<PasskeysScreen />);

    expect(view.getByTestId('passkey-add')).toBeDisabled();
    expect(view.getByText(DEVICE_UNSUPPORTED)).toBeOnTheScreen();
  });

  it('blames the server when the server is the missing side', async () => {
    mockOverview.current = { passkeySupported: false };
    const view = await renderScreen(<PasskeysScreen />);

    expect(view.getByTestId('passkey-add')).toBeDisabled();
    expect(view.getByText(SERVER_UNSUPPORTED)).toBeOnTheScreen();
  });

  /*
   * Before the overview resolves, `passkeySupported` is undefined and the
   * screen must default to *unsupported* rather than offering a button that
   * would fail. The device message wins when both are missing, which is the
   * right order: a user can fix their phone, not the server.
   */
  it('treats an unresolved overview as unsupported rather than offering the button', async () => {
    mockOverview.current = null;
    const view = await renderScreen(<PasskeysScreen />);

    expect(view.getByTestId('passkey-add')).toBeDisabled();
    expect(view.getByText(SERVER_UNSUPPORTED)).toBeOnTheScreen();
  });
});
