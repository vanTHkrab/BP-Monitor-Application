#!/usr/bin/env node
/**
 * Verifies that every on-device ONNX model bundled under
 * client/assets/models/ matches the canonical SHA256 recorded in the
 * ai-service manifest (server/app/ai-service/models/EXPECTED_HASHES.json).
 *
 * Runs as a prestart / preandroid / preios hook so a stale on-device
 * model can never silently disagree with backend inference.
 *
 * Two models are bundled and shared with the backend verbatim:
 *   - yolo11n.onnx  (YOLOv11n detector — on-device pre-flight / ROI)
 *   - crnn.onnx     (7-seg CRNN digit recognizer — offline OCR prefill)
 *
 * The backend no longer tracks the binaries in git (they are fetched from
 * R2 against the same manifest); only EXPECTED_HASHES.json is tracked. So
 * we verify the bundled bytes against the manifest entry, not against a
 * backend copy that may be absent in a fresh checkout / CI.
 *
 * Fail conditions:
 *  - a bundled file is missing
 *  - the manifest has no entry for a bundled model (misconfiguration)
 *  - SHA256 mismatch between the bundled bytes and the manifest
 *
 * Recovery: pnpm run sync-yolo-model
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Models bundled in the mobile app + verified against the backend manifest.
const MODELS = ['yolo11n.onnx', 'crnn.onnx'];

const modelsDir = resolve(here, '..', 'assets', 'models');
const manifestPath = resolve(
  here,
  '..',
  '..',
  'server',
  'app',
  'ai-service',
  'models',
  'EXPECTED_HASHES.json',
);

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fail(msg) {
  console.error(`\n[verify-models] ${msg}`);
  console.error('[verify-models] Fix: pnpm run sync-yolo-model\n');
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  console.warn(
    `[verify-models] Manifest not found at ${manifestPath}; ` +
      'skipping verification (likely running outside the monorepo checkout).',
  );
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (err) {
  fail(`Could not parse manifest ${manifestPath}: ${err.message}`);
}

for (const name of MODELS) {
  const bundled = resolve(modelsDir, name);
  if (!existsSync(bundled)) fail(`Bundled model missing: ${bundled}`);

  const expected = manifest[name];
  if (!expected) {
    fail(`Manifest has no SHA256 entry for ${name} (${manifestPath})`);
  }

  const actual = sha256(bundled);
  if (actual !== expected) {
    fail(
      `SHA256 mismatch for ${name}:\n` +
        `  bundled:  ${actual}\n` +
        `  expected: ${expected}  (from EXPECTED_HASHES.json)`,
    );
  }

  console.log(`[verify-models] OK ${name} (sha256=${actual.slice(0, 12)}…)`);
}
