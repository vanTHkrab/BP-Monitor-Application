// React Native autolinking config.
//
// onnxruntime-react-native (v1.24.x) ships with a `unimodule.json` (legacy
// Expo SDK ≤40 format) plus an `app.plugin.js` Expo config plugin. The
// config plugin only adds the gradle sub-project dependency — it does NOT
// register `OnnxruntimePackage` with React Native. Meanwhile the
// `unimodule.json` marker makes Expo's autolinker treat the package as a
// unimodule and skip the community-CLI autolinking that would otherwise
// pick up the ReactPackage automatically.
//
// Net effect: `.so` files end up in the APK, but
// `NativeModules.OnnxruntimeModule` resolves to null at runtime, so the
// JS-side require crashes with "Cannot read property 'install' of null".
//
// This file declares the dependency for the community-CLI autolinking path,
// which is read by `EXPO_USE_COMMUNITY_AUTOLINKING=1`-mode builds. The
// default Expo autolinker ignores it, so the real runtime fix lives in
// `android/app/src/main/java/.../MainApplication.kt` — search for
// `OnnxruntimePackage` there. If you ever run `expo prebuild --clean`,
// the MainApplication.kt edit will be wiped and pre-flight detection
// will silently fall back to backend-only analysis (via the catch in
// `lib/yolo/session.ts`). Re-apply the manual `add(OnnxruntimePackage())`
// line after prebuild.
module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: {
        android: {
          sourceDir: './node_modules/onnxruntime-react-native/android',
          packageImportPath: 'import ai.onnxruntime.reactnative.OnnxruntimePackage;',
          packageInstance: 'new OnnxruntimePackage()',
        },
      },
    },
  },
};
