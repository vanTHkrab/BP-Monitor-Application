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
