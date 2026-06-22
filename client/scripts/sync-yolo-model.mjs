#!/usr/bin/env node
/**
 * Copies the canonical yolo11n.onnx from the ai-service into client/assets/models/.
 * Run this whenever the ai-service retrains the detector so the on-device
 * pre-flight check stays in sync with backend inference.
 *
 * After running, commit both client/assets/models/yolo11n.onnx and the
 * matching ai-service file in the same change.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundled = resolve(here, '..', 'assets', 'models', 'yolo11n.onnx');
const canonical = resolve(
  here,
  '..',
  '..',
  'server',
  'app',
  'ai-service',
  'models',
  'yolo11n.onnx',
);

if (!existsSync(canonical)) {
  console.error(`[sync-yolo-model] Canonical model missing: ${canonical}`);
  process.exit(1);
}

mkdirSync(dirname(bundled), { recursive: true });
copyFileSync(canonical, bundled);

const hash = createHash('sha256').update(readFileSync(bundled)).digest('hex');
console.log(`[sync-yolo-model] Copied to ${bundled}`);
console.log(`[sync-yolo-model] sha256=${hash}`);
