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
