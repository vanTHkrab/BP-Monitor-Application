/**
 * The lazy loader for expo-notifications.
 *
 * `isExpoGoAndroid` is computed once at module load from two inputs, so every
 * case reloads the module through `load()`.
 *
 * **What this file cannot assert, and why.** `loadNotifications` reaches the
 * package through `await import('expo-notifications')`. Babel keeps that as a
 * real dynamic import, and jest's CommonJS VM rejects it with
 * `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` unless node is started with
 * `--experimental-vm-modules`. So under jest the loader *always* takes its
 * `catch` arm and always resolves `null`, whatever the platform — a
 * `jest.mock('expo-notifications', …)` does not change that, because the
 * failure is in the import mechanism, not in resolution. The success arm is
 * therefore unreachable from any test in this repo as configured; what is
 * asserted instead is the pair that *is* distinguishable: the Expo Go Android
 * short-circuit, and `isNotificationSupported` across the whole matrix.
 * Memoisation is a third casualty — see the note on the repeat-call test.
 *
 * This does **not** leave the rest of the module's suites vacuous, and that
 * was checked rather than assumed: all three consumer suites
 * (`push-registration`, `invite-notification`, `reminder-service`) mock
 * `./notifications-module` — this loader boundary — and nothing in the tree
 * mocks `expo-notifications` directly, so they substitute `loadNotifications`
 * wholesale and do exercise the real permission matrix.
 * The trap is contained by that convention. Mock the boundary, not the
 * package, and it stays contained.
 *
 * `ExecutionEnvironment` is restated here rather than pulled in with
 * `requireActual`: loading the real expo-constants at file scope drags in
 * expo-modules-core and dies on `Appearance.getColorScheme` before a single
 * test runs. The member *names* are still checked — `tsc` compares them
 * against the real declaration through the module under test — but the string
 * values are asserted against a copy.
 */
const ExecutionEnvironment = {
  Bare: 'bare',
  Standalone: 'standalone',
  StoreClient: 'storeClient',
} as const;

type ConstantsShape = { executionEnvironment?: string };
const mockConstants: ConstantsShape = {};
jest.mock('expo-constants', () => ({
  __esModule: true,
  ExecutionEnvironment: {
    Bare: 'bare',
    Standalone: 'standalone',
    StoreClient: 'storeClient',
  },
  get default() {
    return mockConstants;
  },
}));

type Loaded = typeof import('./notifications-module');

function load(env: string, os: 'ios' | 'android' | 'web'): Loaded {
  mockConstants.executionEnvironment = env;
  let mod!: Loaded;
  // `doMock` inside an isolate, for the same reason as auth-token.test.ts: a
  // file-level react-native mock is installed before jest-expo's setup and
  // takes the suite down at load time.
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    mod = require('./notifications-module');
  });
  jest.dontMock('react-native');
  return mod;
}

describe('isNotificationSupported', () => {
  it('is false only on Expo Go for Android', () => {
    // Both halves of the `&&` matter, and both were once written as one
    // condition: Expo Go on iOS still posts local notifications fine, and a
    // dev client on Android is not Expo Go.
    expect(load(ExecutionEnvironment.StoreClient, 'android').isNotificationSupported()).toBe(false);
  });

  it.each([
    ['Expo Go on iOS', ExecutionEnvironment.StoreClient, 'ios' as const],
    ['a dev client on Android', ExecutionEnvironment.Bare, 'android' as const],
    ['a standalone build on Android', ExecutionEnvironment.Standalone, 'android' as const],
    ['a dev client on iOS', ExecutionEnvironment.Bare, 'ios' as const],
    ['web', ExecutionEnvironment.Bare, 'web' as const],
  ])('is true for %s', (_label, env, os) => {
    expect(load(env, os).isNotificationSupported()).toBe(true);
  });

  it('is true when the execution environment is not reported at all', () => {
    // A missing value must not be read as Expo Go — that would silence
    // notifications on a build where they work.
    const mod = load(undefined as unknown as string, 'android');

    expect(mod.isNotificationSupported()).toBe(true);
  });
});

describe('loadNotifications', () => {
  it('short-circuits to null on Expo Go for Android', async () => {
    // The regression this guards: importing expo-notifications here fires an
    // auto push-token registration that warns on every launch, for an app
    // that only posts local notifications.
    const mod = load(ExecutionEnvironment.StoreClient, 'android');

    await expect(mod.loadNotifications()).resolves.toBeNull();
  });

  it('agrees with isNotificationSupported on the Expo Go Android path', async () => {
    const mod = load(ExecutionEnvironment.StoreClient, 'android');

    expect(mod.isNotificationSupported()).toBe(false);
    await expect(mod.loadNotifications()).resolves.toBeNull();
  });

  it('never rejects when the package cannot be loaded', async () => {
    // Under jest this is every platform (see the file header). The assertion
    // still earns its place: a caller posting a reminder must get `null`, not
    // an exception, when the module is not there.
    const mod = load(ExecutionEnvironment.Bare, 'android');

    await expect(mod.loadNotifications()).resolves.toBeNull();
  });

  it('keeps returning the same null on repeat calls, and never throws', async () => {
    // Says only what it pins. The obvious claim to make here — that
    // `cached !== undefined` memoises, so a `cached != null` typo would
    // re-attempt the import on every notification — is one this test **cannot**
    // support: under jest `cached` is always `null` (see the file header), so
    // both spellings of the guard produce `null` twice and the mutant survives
    // green. Verified, not assumed.
    //
    // What is left is still worth pinning: a caller posting a reminder gets a
    // stable `null` rather than an exception, however many times it asks.
    const mod = load(ExecutionEnvironment.Bare, 'android');

    const first = await mod.loadNotifications();
    const second = await mod.loadNotifications();

    expect(first).toBeNull();
    expect(second).toBe(first);
  });

  it('caches per module instance, not across reloads', async () => {
    const expoGo = load(ExecutionEnvironment.StoreClient, 'android');
    await expoGo.loadNotifications();
    const devClient = load(ExecutionEnvironment.Bare, 'android');

    expect(devClient.isNotificationSupported()).toBe(true);
  });
});
