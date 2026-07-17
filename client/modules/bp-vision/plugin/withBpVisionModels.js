// Expo config plugin for the local bp-vision module.
//
// Copies the bundled on-device ONNX models from client/assets/models/ into
// the generated Android project's asset dir (android/app/src/main/assets/
// models/) on every `expo prebuild`. Packaging them as Android assets lets
// BPVisionModule.kt load the model bytes straight from the APK via the
// AssetManager (assets.open("models/<name>")) — no adb push, no runtime
// download.
//
// Single source of truth: client/assets/models/ stays the only committed
// copy (SHA256-gated by scripts/verify-models.mjs against the ai-service
// EXPECTED_HASHES.json manifest). This plugin just mirrors it into the
// throwaway, regenerated android/ tree at prebuild time.
//
// Written as plain JS (not TS) on purpose: a local Expo module has no
// plugin build step, so a compiled-from-TS plugin could silently go stale.
// Referenced from app.json by relative path.
//
// Android-only, matching the module (iOS/web keep using expo-camera and
// have no on-device inference yet).
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Keep in sync with scripts/verify-models.mjs MODELS and the loader in
// android/.../BPVisionModule.kt (ASSET_MODEL_DIR + model file names).
const MODELS = ['yolo11n.onnx', 'crnn_int8.onnx'];
const ASSET_SUBDIR = 'models';

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withBpVisionModels = (config) =>
  withDangerousMod(config, [
    'android',
    (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const srcDir = path.join(projectRoot, 'assets', ASSET_SUBDIR);
      const destDir = path.join(
        platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        ASSET_SUBDIR,
      );

      fs.mkdirSync(destDir, { recursive: true });

      for (const name of MODELS) {
        const src = path.join(srcDir, name);
        if (!fs.existsSync(src)) {
          throw new Error(
            `[bp-vision] bundled model missing: ${src}\n` +
              'Run `pnpm sync-yolo-model` (from client/) to restore it.',
          );
        }
        fs.copyFileSync(src, path.join(destDir, name));
      }

      return config;
    },
  ]);

module.exports = withBpVisionModels;
