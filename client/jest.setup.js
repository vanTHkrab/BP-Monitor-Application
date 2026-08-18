/**
 * Shared jest setup.
 *
 * ## Why reanimated is mocked by hand
 *
 * Reanimated 4 pulls in react-native-worklets, which reaches for a native
 * module at import time and dies under jest-expo with `Cannot read properties
 * of undefined (reading 'loadUnpackers')`. Two off-the-shelf fixes both fail
 * in this tree, so neither is worth rediscovering:
 *
 *   - `react-native-reanimated/mock` imports real values from the package's
 *     own `./index`, so requiring it hits the identical crash it exists to
 *     avoid.
 *   - `react-native-worklets/jest/resolver.js` strips `.native` extensions,
 *     and setting jest's `resolver` displaces the resolution jest-expo needs.
 *     Every expo-modules-core view then resolves to its unmockable `.ios`
 *     implementation and the whole suite fails on `requireNativeViewManager`,
 *     including tests that never touch an animation.
 *
 * So this stub covers exactly what the app uses and nothing more. It renders
 * `Animated.View` as a plain `View`, which means a render test asserts what a
 * screen renders and never how it animates in — motion is deliberately not
 * testable here. Extend the entering-animation list below when a screen
 * starts using another one.
 */
jest.mock('react-native-reanimated', () => {
  const { View, ScrollView, Text, Image } = require('react-native');

  /**
   * Entering/exiting animations are used as chainable builders
   * (`FadeInDown.delay(150).duration(200)`), so every modifier returns the
   * same object. The result is inert: the mocked components ignore it.
   */
  const makeBuilder = () => {
    const builder = {};
    const chainable = [
      'delay',
      'duration',
      'easing',
      'springify',
      'damping',
      'stiffness',
      'mass',
      'randomDelay',
      'reduceMotion',
      'withCallback',
      'withInitialValues',
    ];
    for (const method of chainable) {
      builder[method] = () => builder;
    }
    builder.build = () => () => ({ initialValues: {}, animations: {} });
    return builder;
  };

  const entering = [
    'FadeIn',
    'FadeInDown',
    'FadeInLeft',
    'FadeInRight',
    'FadeInUp',
    'FadeOut',
    'FadeOutDown',
    'FadeOutLeft',
    'FadeOutRight',
    'FadeOutUp',
  ];

  const animations = Object.fromEntries(
    entering.map((name) => [name, makeBuilder()]),
  );

  const Animated = { View, ScrollView, Text, Image, createAnimatedComponent: (c) => c };

  return {
    __esModule: true,
    default: Animated,
    ...animations,
    Easing: {
      linear: () => 0,
      ease: () => 0,
      in: (fn) => fn,
      out: (fn) => fn,
      inOut: (fn) => fn,
    },
  };
});

/**
 * AsyncStorage's native module is null under jest-expo, and the package
 * throws at *import* time rather than on first use — so the failure is a
 * suite that will not load, not a test that fails.
 *
 * Global rather than per-file for the same reason google-signin is: the
 * indirection is the problem. Every screen that renders a `ThemedText` gets
 * here through `useFontScale` → `usePreferencesStore` → AsyncStorage, which
 * is very nearly every screen in the app. Discovering that one file at a time
 * is pure tax, and a per-file version of this stub cannot satisfy another
 * screen's assertion by accident because it is the package's own official
 * in-memory mock, not a behavioural stand-in.
 *
 * Screen tests written before this existed still declare it locally. That is
 * harmless — a file-level `jest.mock` for the same module simply wins — and
 * removing them is a drive-by this change does not make.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/**
 * Google sign-in is a TurboModule with nothing behind it under jest, and
 * `@/modules/auth`'s barrel imports the hook that uses it — so *anything*
 * reaching that barrel, however indirectly, fails to load without this.
 *
 * Mocked globally rather than per test because the indirection is the
 * problem: a pure mapper in `modules/caregivers` ends up here through two
 * barrels, and discovering that one file at a time is pure tax. The real fix
 * is for the auth barrel not to pull a native module at import time — noted
 * in docs/project/CLIENT-caregiver.md.
 */
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

/**
 * `expo-image` 57.0.2 wires an `expo-observe` integration at import time, and
 * jest-expo's native-module stub makes that crash every suite that renders an
 * image — `TypeError: observe.getIntegrations is not a function`, thrown from
 * `expo-image/src/observe.ts` before a single test runs. Twenty-six suites
 * failed to load on the SDK 57 patch bump because of it.
 *
 * The production path is fine, and that is the point. `expo-observe` is not a
 * dependency of this project, so on a device
 * `requireOptionalNativeModule('ExpoObserve')` returns `null` and the
 * integration returns early. Under jest-expo the same call returns a truthy
 * stub with none of the methods on it, the `if (!observe) return` guard
 * passes, and the next line dereferences a function that was never there.
 *
 * So this is not papering over a defect in `expo-image` — it is making the
 * test environment agree with the device about a module the app does not
 * install. Scoped to that one module name rather than mocking `expo`
 * wholesale: every other `requireOptionalNativeModule` call still resolves
 * through the real implementation.
 *
 * Remove this when jest-expo stops stubbing unlisted native modules as
 * truthy, or when `expo-image` guards on a method rather than on the object.
 */
jest.mock('expo', () => {
  const actual = jest.requireActual('expo');

  return {
    ...actual,
    requireOptionalNativeModule: (name) =>
      name === 'ExpoObserve' ? null : actual.requireOptionalNativeModule(name),
  };
});

/**
 * `react-native-keyboard-controller` ships its own jest mock, and the app now
 * mounts `KeyboardProvider` at the root — so every screen test renders through
 * it whether or not the screen cares about the keyboard.
 *
 * Pointed at the package's own `jest` entry rather than hand-stubbed: the
 * surface is wide (a provider, `KeyboardAwareScrollView`, `useKeyboardHandler`
 * and friends, plus reanimated-shaped shared values with `.get()`/`.set()`),
 * and a hand-written subset would go stale the first time a screen reaches for
 * a hook nobody stubbed — silently, since the module resolves either way.
 */
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);
