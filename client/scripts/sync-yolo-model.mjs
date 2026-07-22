#!/usr/bin/env node
/**
 * Copies the canonical on-device ONNX models from the ai-service into
 * client/assets/models/. Run this whenever the ai-service retrains a model
 * so the bundled on-device copies stay byte-identical to backend inference.
 *
 * Syncs both shared models:
 *   - yolo11n.onnx  (YOLOv11n detector)
 *   - crnn.onnx     (7-seg CRNN digit recognizer)
 *
 * The backend fetches these from R2 on first start (they are not tracked in
 * git there), so run `uv run python -m ai_service.scripts.fetch_models` in
 * server/app/ai-service/ first if the canonical files are missing locally.
 *
 * After running, commit the refreshed client/assets/models/*.onnx together
 * with the matching EXPECTED_HASHES.json update in the same change, then
 * verify with `pnpm verify-models`.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const MODELS = ['yolo11n.onnx', 'crnn.onnx'];

const bundledDir = resolve(here, '..', 'assets', 'models');
const canonicalDir = resolve(
  here,
  '..',
  '..',
  'server',
  'app',
  'ai-service',
  'models',
);

mkdirSync(bundledDir, { recursive: true });

let failed = false;
for (const name of MODELS) {
  const canonical = resolve(canonicalDir, name);
  const bundled = resolve(bundledDir, name);

  if (!existsSync(canonical)) {
    console.error(
      `[sync-yolo-model] Canonical model missing: ${canonical}\n` +
        '[sync-yolo-model] Fetch it first: (cd server/app/ai-service && ' +
        'uv run python -m ai_service.scripts.fetch_models)',
    );
    failed = true;
    continue;
  }

  copyFileSync(canonical, bundled);
  const hash = createHash('sha256').update(readFileSync(bundled)).digest('hex');
  console.log(`[sync-yolo-model] Copied ${name} -> ${bundled}`);
  console.log(`[sync-yolo-model]   sha256=${hash}`);
}

if (failed) process.exit(1);
