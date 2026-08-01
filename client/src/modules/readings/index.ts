/**
 * Public surface of the readings module. Screens import from here, never from
 * a file inside — same rule as the other modules, and it matters more here.
 *
 * `repository/*` and `services/*` stay unexported. A screen writing SQLite
 * directly would skip the `clientId` minting and the queue-first ordering
 * that `use-create-reading.ts` owns, and a reading saved without a client id
 * is a reading the server's duplicate guard cannot protect. A screen calling
 * `readings-api` directly would bypass the mirror entirely and render data
 * that vanishes the moment the app goes offline.
 *
 * `lib/sync.ts` is exported for its types and its test seam only — the drain
 * is wired to real I/O in exactly one place, `hooks/use-sync-readings.ts`.
 */
export { useCreateReading } from './hooks/use-create-reading';
export { useDeleteReading } from './hooks/use-delete-reading';
export { useFetchReadings } from './hooks/use-fetch-readings';
export { useReadings, type UseReadingsOptions } from './hooks/use-readings';
export { useSyncReadings } from './hooks/use-sync-readings';

export { createReadingClientId } from './lib/client-id';
export {
  BP_THRESHOLDS,
  classifyReading,
  parseStatus,
  statusColorFor,
  statusGuidance,
  statusLabel,
} from './lib/status';
export { byMeasuredAtDesc, mergeReadings, readingKey } from './lib/mappers';
export {
  LocalImageMissing,
  drainQueue,
  runSync,
  type SyncPorts,
  type SyncResult,
} from './lib/sync';

export type { BPStatus, CreateReadingInput, Reading, ReadingSyncState } from './types';
