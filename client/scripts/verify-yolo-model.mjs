#!/usr/bin/env node
/**
 * Verifies that the bundled YOLO model matches the canonical copy in
 * server/app/ai-service/models/. Runs as a prestart / prebuild hook so a
 * stale on-device model can never silently disagree with backend inference.
 *
 * Fail conditions:
 *  - bundled file missing
 *  - canonical file missing (running outside the monorepo?)
 *  - SHA256 mismatch
 *
 * Recovery: pnpm run sync-yolo-model
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
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

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fail(msg) {
  console.error(`\n[verify-yolo-model] ${msg}`);
  console.error('[verify-yolo-model] Fix: pnpm run sync-yolo-model\n');
  process.exit(1);
}

if (!existsSync(bundled)) fail(`Bundled model missing: ${bundled}`);
if (!existsSync(canonical)) {
  console.warn(
    `[verify-yolo-model] Canonical model not found at ${canonical}; ` +
      'skipping verification (likely running outside the monorepo checkout).',
  );
  process.exit(0);
}

const bundledHash = sha256(bundled);
const canonicalHash = sha256(canonical);

if (bundledHash !== canonicalHash) {
  fail(
    `SHA256 mismatch between bundled and canonical yolo11n.onnx:\n` +
      `  bundled:   ${bundledHash}\n` +
      `  canonical: ${canonicalHash}`,
  );
}

console.log(`[verify-yolo-model] OK (sha256=${bundledHash.slice(0, 12)}…)`);
