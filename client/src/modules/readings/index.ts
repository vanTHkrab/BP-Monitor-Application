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
 *
 * `services/export-file.ts` is unexported for the same family of reason:
 * `useExportReadings` owns resolving *whose* readings are being exported, and
 * a screen that skipped it would put the caregiver's name on the patient's
 * report. The pure builders in `lib/export.ts` stay internal too — nothing
 * outside this module has a `Reading[]` to build a report from.
 *
 * `useFetchReadings` and `useSyncReadings` are **not** exported for the same
 * reason. Screens used to call both, which is how the app ended up with a
 * pull nobody triggered and four copies of every sync listener. The app-level
 * `ReadingsSyncProvider` owns them now; a screen gets `useReadingsSync()`.
 */
export { useAlerts, useMarkAlertRead, useMarkAllAlertsRead } from './hooks/use-alerts';
export { useCreateReading } from './hooks/use-create-reading';
export { useDeleteReading } from './hooks/use-delete-reading';
export { useExportReadings } from './hooks/use-export-readings';
export { useReadings, type UseReadingsOptions } from './hooks/use-readings';
export { useResolvedImageUri } from './hooks/use-resolved-image-uri';
export {
  ReadingsSyncProvider,
  useReadingsSync,
  type ReadingsSyncValue,
} from './hooks/use-readings-sync';

export { BPReadingCard } from './components/bp-reading-card';
export { BPTrendChart } from './components/bp-trend-chart';
export { ExportFormatSheet } from './components/export-format-sheet';
export { GuidanceCard, EMERGENCY_NUMBER } from './components/guidance-card';
export { LatestReadingCard } from './components/latest-reading-card';

export { createReadingClientId } from './lib/client-id';
export { cleanupExpiredImages } from './lib/image-cache';
export { cleanupOrphanedPendingImages } from './lib/pending-image-store';
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
  DEFAULT_TIME_FILTER,
  TIME_FILTERS,
  chartMaxValue,
  chartSeries,
  cutoffFor,
  filterByRange,
  type TimeFilter,
  type TimeRange,
} from './lib/time-filter';
export {
  LocalImageMissing,
  drainQueue,
  runSync,
  type SyncPorts,
  type SyncResult,
} from './lib/sync';

export type {
  Alert,
  BPStatus,
  CreateReadingInput,
  Reading,
  ReadingSyncState,
} from './types';
