/**
 * The app lock: a Zustand store read by two unrelated places — the settings
 * toggle and the gate wrapping the whole navigator.
 *
 * One branch here is worth more than the rest. `hydrate` computes
 * `usable = enabled && capability.available`, and that `&&` is the only thing
 * standing between a user and their own health record: someone who turned the
 * lock on and later removed their screen lock at the OS level has a preference
 * saying "locked" and no way to unlock. Dropping the capability half leaves a
 * gate up that nothing can open, and it fails for exactly the people least
 * able to work around it. It is the first test in the hydration block, and it
 * is the reason `enabled: false` is asserted alongside `unlocked: true` rather
 * than instead of it — the store's two flags have to agree.
 *
 * `expo-local-authentication` and `expo-secure-store` are mocked at the
 * package boundary, leaving `lib/app-lock.ts`'s real translation from
 * `supportedAuthenticationTypesAsync()` to a Thai label under test.
 *
 * The store is a module singleton, so `beforeEach` resets it explicitly;
 * leaking `enabled: true` into the next case would make `useAppLock`'s
 * hydrate-once guard skip and every assertion after it meaningless.
 */
const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
}));

const mockHasHardwareAsync = jest.fn();
const mockIsEnrolledAsync = jest.fn();
const mockSupportedTypesAsync = jest.fn();
const mockAuthenticateAsync = jest.fn();
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: () => mockHasHardwareAsync(),
  isEnrolledAsync: () => mockIsEnrolledAsync(),
  supportedAuthenticationTypesAsync: () => mockSupportedTypesAsync(),
  authenticateAsync: (...args: unknown[]) => mockAuthenticateAsync(...args),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { STORAGE_KEYS } from '@/config';

import { promptDeviceUnlock, useAppLock, useAppLockStore } from './use-app-lock';

const FINGERPRINT = 1;
const FACE = 2;
const IRIS = 3;

/** The preference SecureStore holds, and what the hardware reports. */
function device(options: {
  stored?: string | null;
  hardware?: boolean;
  enrolled?: boolean;
  types?: number[];
}): void {
  mockGetItemAsync.mockResolvedValue(options.stored ?? null);
  mockHasHardwareAsync.mockResolvedValue(options.hardware ?? true);
  mockIsEnrolledAsync.mockResolvedValue(options.enrolled ?? true);
  mockSupportedTypesAsync.mockResolvedValue(options.types ?? [FINGERPRINT]);
}

const read = () => useAppLockStore.getState();

const hydrate = () => act(async () => read().hydrate());

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItemAsync.mockReset();
  mockSetItemAsync.mockReset();
  mockHasHardwareAsync.mockReset();
  mockIsEnrolledAsync.mockReset();
  mockSupportedTypesAsync.mockReset();
  mockAuthenticateAsync.mockReset();

  mockSetItemAsync.mockResolvedValue(undefined);
  device({});

  // Merge, not replace — a replace would drop the actions along with the
  // state.
  useAppLockStore.setState({ enabled: null, unlocked: true, capability: null });
});

describe('the initial state, before SecureStore has been read', () => {
  it('starts unknown and unlocked', () => {
    // `enabled: null` is what tells the gate not to act yet, and starting
    // locked would flash a lock screen at every user who never enabled the
    // feature, on every cold start.
    expect(read().enabled).toBeNull();
    expect(read().unlocked).toBe(true);
    expect(read().capability).toBeNull();
  });
});

describe('hydrate', () => {
  it('treats a lock whose screen lock has since been removed as off', async () => {
    // The user turned this on, then removed their PIN at the OS level. The
    // preference still says "true" and there is now no way to satisfy the
    // prompt.
    device({ stored: 'true', hardware: true, enrolled: false });

    await hydrate();

    // Both flags, together. `enabled: false` with `unlocked: false` would
    // leave the gate up with the toggle showing "off" — unopenable, and
    // nothing on screen explaining why.
    expect(read().enabled).toBe(false);
    expect(read().unlocked).toBe(true);
    expect(read().capability?.available).toBe(false);
  });

  it('treats missing hardware the same way', async () => {
    device({ stored: 'true', hardware: false, enrolled: true });

    await hydrate();

    expect(read().enabled).toBe(false);
    expect(read().unlocked).toBe(true);
  });

  it('puts the gate up when the lock is on and the device can open it', async () => {
    device({ stored: 'true', types: [FINGERPRINT] });

    await hydrate();

    expect(read().enabled).toBe(true);
    // The one case that starts locked.
    expect(read().unlocked).toBe(false);
  });

  it('stays unlocked when the user never turned it on', async () => {
    device({ stored: null });

    await hydrate();

    expect(read().enabled).toBe(false);
    expect(read().unlocked).toBe(true);
  });

  it('reads the preference from the app-lock key, not the auth-token one', async () => {
    await hydrate();

    expect(mockGetItemAsync).toHaveBeenCalledWith(STORAGE_KEYS.appLock);
  });

  it('treats any stored value other than "true" as off', async () => {
    device({ stored: 'false' });
    await hydrate();
    expect(read().enabled).toBe(false);

    device({ stored: '1' });
    await hydrate();
    // A loose truthiness check here would turn a legacy '1' into a lock the
    // settings screen never wrote.
    expect(read().enabled).toBe(false);
  });

  it('fails to off when the keystore is in a bad state', async () => {
    device({ stored: 'true' });
    mockGetItemAsync.mockRejectedValue(new Error('Keystore unavailable'));

    await hydrate();

    // Deliberate: the alternative locks someone out of their own health
    // record because of a storage error they cannot see or fix.
    expect(read().enabled).toBe(false);
    expect(read().unlocked).toBe(true);
  });

  it.each([
    [[FACE], 'face', 'สแกนใบหน้า'],
    [[FINGERPRINT], 'fingerprint', 'ลายนิ้วมือ'],
    [[IRIS], 'iris', 'สแกนม่านตา'],
    [[], 'passcode', 'รหัสปลดล็อกเครื่อง'],
  ])('labels %j as %s', async (types, kind, label) => {
    device({ stored: 'true', types: types as number[] });

    await hydrate();

    expect(read().capability).toEqual({ available: true, kind, label });
  });

  // Reversed by explicit user decision: fingerprint over face when a device
  // enrolls both. The prompt itself shows whatever the OS picks, but the
  // settings row names one thing, and fingerprint is the one asked for.
  it('prefers the fingerprint label when a device offers both', async () => {
    device({ stored: 'true', types: [FINGERPRINT, FACE] });

    await hydrate();

    expect(read().capability?.kind).toBe('fingerprint');
  });

  it('still reports an enrolled PIN as usable', async () => {
    device({ stored: 'true', types: [] });

    await hydrate();

    // `available: false` here would silently disable the feature for every
    // user with a pattern or PIN rather than a biometric.
    expect(read().capability?.available).toBe(true);
    expect(read().enabled).toBe(true);
    expect(read().unlocked).toBe(false);
  });
});

describe('setEnabled', () => {
  it('persists "true" and leaves the app open', async () => {
    await act(async () => read().setEnabled(true));

    expect(mockSetItemAsync).toHaveBeenCalledWith(STORAGE_KEYS.appLock, 'true');
    // Locking immediately on the settings screen would throw a prompt at the
    // user for flipping the switch they are looking at.
    expect(read().enabled).toBe(true);
    expect(read().unlocked).toBe(true);
  });

  it('persists the string "false" rather than removing the key', async () => {
    await act(async () => read().setEnabled(false));

    // `isAppLockEnabled` compares against 'true', so an absent key and
    // 'false' behave alike — but writing it keeps a previously stored 'true'
    // from surviving the toggle.
    expect(mockSetItemAsync).toHaveBeenCalledWith(STORAGE_KEYS.appLock, 'false');
    expect(read().enabled).toBe(false);
    expect(read().unlocked).toBe(true);
  });

  it('does not skip the capability check the next hydrate performs', async () => {
    await act(async () => read().setEnabled(true));

    // `setEnabled` writes `enabled` from the argument without consulting the
    // hardware — correct, because the settings screen has already checked —
    // but it means `capability` is untouched and a later hydrate is still
    // what decides usability.
    expect(read().capability).toBeNull();
    expect(mockHasHardwareAsync).not.toHaveBeenCalled();
  });

  it('leaves the state alone when SecureStore refuses the write', async () => {
    mockSetItemAsync.mockRejectedValue(new Error('Keystore unavailable'));

    await act(async () => {
      await read()
        .setEnabled(true)
        .catch(() => {});
    });

    // The store must not claim a lock the device did not persist: the next
    // cold start would hydrate to "off" and the two would disagree.
    expect(read().enabled).toBeNull();
  });
});

describe('lock and unlock', () => {
  it('raises and drops the gate without touching the preference', async () => {
    device({ stored: 'true' });
    await hydrate();

    // Every `act` in this file is awaited, including the ones wrapping a
    // synchronous store write. RNTL v14's `act` returns a thenable; dropping
    // it leaves React's act scope unbalanced, and the damage lands on the
    // *next* test in the file — `renderHook` there returns a `result` whose
    // `current` is never populated, which reads as the hook itself being
    // broken.
    await act(async () => {
      read().unlock();
    });
    expect(read().unlocked).toBe(true);
    expect(read().enabled).toBe(true);

    await act(async () => {
      read().lock();
    });
    expect(read().unlocked).toBe(false);
    // Backgrounding the app must not turn the feature off.
    expect(read().enabled).toBe(true);
    expect(mockSetItemAsync).not.toHaveBeenCalled();
  });
});

describe('useAppLock', () => {
  it('hydrates on mount so a display-only screen does not have to', async () => {
    device({ stored: 'true' });

    const view = await renderHook(() => useAppLock());

    await waitFor(() => expect(view.result.current.enabled).toBe(true));
    expect(view.result.current.capability?.kind).toBe('fingerprint');
  });

  it('does not hydrate twice while the first read is still in flight', async () => {
    device({ stored: 'true' });

    const view = await renderHook(() => useAppLock());
    await waitFor(() => expect(view.result.current.enabled).not.toBeNull());

    // The effect depends on the whole store object, which changes identity on
    // every `set`. Without the `enabled === null` guard this re-enters on each
    // hydration-induced render, and every re-entry is another SecureStore read
    // and another round of native capability calls during app start-up.
    expect(mockGetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockHasHardwareAsync).toHaveBeenCalledTimes(1);
  });

  it('does not re-hydrate for a screen mounted after the store is populated', async () => {
    device({ stored: 'true' });
    await hydrate();
    mockGetItemAsync.mockClear();

    await renderHook(() => useAppLock());

    expect(mockGetItemAsync).not.toHaveBeenCalled();
  });

  it('exposes the same state the gate reads, not a copy', async () => {
    device({ stored: 'true' });
    const view = await renderHook(() => useAppLock());
    await waitFor(() => expect(view.result.current.enabled).toBe(true));

    await act(async () => {
      useAppLockStore.getState().lock();
    });

    // The settings row and the navigator gate are two subscribers to one
    // store; a lock whose two halves disagree is worse than no lock.
    expect(view.result.current.unlocked).toBe(false);
  });
});

describe('promptDeviceUnlock', () => {
  it('allows the device passcode as a fallback', async () => {
    mockAuthenticateAsync.mockResolvedValue({ success: true });

    await promptDeviceUnlock('ปลดล็อกเพื่อดูข้อมูล');

    // `disableDeviceFallback: true` would make a fingerprint that stops
    // reading — wet hands, a bandage, a worn sensor — the end of the road,
    // and the lock becomes a way to lose access to your own readings.
    expect(mockAuthenticateAsync).toHaveBeenCalledWith({
      promptMessage: 'ปลดล็อกเพื่อดูข้อมูล',
      cancelLabel: 'ยกเลิก',
      disableDeviceFallback: false,
    });
  });

  it('reports success and refusal as a plain boolean', async () => {
    mockAuthenticateAsync.mockResolvedValue({ success: true });
    await expect(promptDeviceUnlock('x')).resolves.toBe(true);

    mockAuthenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' });
    // The caller decides what a refusal means; collapsing it to a throw would
    // make "the user tapped cancel" indistinguishable from "the sensor broke".
    await expect(promptDeviceUnlock('x')).resolves.toBe(false);
  });

  it('reports a lockout as a refusal rather than throwing', async () => {
    mockAuthenticateAsync.mockResolvedValue({ success: false, error: 'lockout' });

    await expect(promptDeviceUnlock('x')).resolves.toBe(false);
  });
});
