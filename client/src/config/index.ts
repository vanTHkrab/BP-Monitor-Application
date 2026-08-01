/**
 * Runtime configuration.
 *
 * Three things live here, and the test for admission is narrow:
 *
 *   - `env.ts`      — values that come from the environment
 *   - `app.ts`      — numbers two unrelated modules must agree on
 *   - `storage-keys.ts` — the device-storage namespace, which must be unique
 *                          across the whole app or data is silently overwritten
 *
 * Everything else stays with the code that enforces it. A constant that only
 * one file reads is not configuration, it is that file's business.
 *
 * **This directory does not hold tool config.** `app.json`, `babel.config.js`,
 * `metro.config.js`, `tailwind.config.js`, `tsconfig.json`,
 * `eslint.config.js`, and `drizzle.config.ts` stay at the project root because
 * the tools that read them resolve from there. Nothing can be done about that
 * from inside `src/`.
 */
export { env, isDev, platform } from './env';
export { cache, network, pagination } from './app';
export {
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  reminderSettingsKey,
  type StorageKeyName,
} from './storage-keys';
