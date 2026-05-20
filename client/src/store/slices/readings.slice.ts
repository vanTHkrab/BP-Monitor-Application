import { graphqlRequest } from "@/src/core/graphql/client";
import {
    GQL_ALERTS,
    GQL_CREATE_READING,
    GQL_DELETE_READING,
    GQL_MARK_ALERT_READ,
    GQL_MARK_ALL_ALERTS_READ,
    GQL_READINGS,
} from "@/src/core/graphql/operations";
import {
    deletePendingReading,
    deleteSyncedReadingByRemoteId,
    insertPendingReading,
    listLocalReadings,
    listPendingReadings,
    markReadingSynced,
    upsertSyncedReading,
} from "@/src/data/queries/readings";
import { getBPStatus } from "@/src/themes/colors";
import { AppAlert, BloodPressureReading } from "@/src/types";
import type {
    AlertsQuery,
    CreateReadingMutation,
    ReadingGql,
    ReadingsQuery,
} from "@/src/types/graphql";
import { resolveImageUri } from "@/src/utils/image-cache";
import { LocalImageMissingError, uploadImageViaPresign } from "@/src/utils/upload-image";
import type { StateCreator } from "zustand";
import {
    createClientId,
    isLocalReadingId,
    parseLocalReadingId,
    toLocalReadingId,
} from "../shared/client-id";
import { logWarn } from "../shared/log";
import {
    alertFromGql,
    readingFromGql,
    readingFromRow,
    sortReadingsDesc,
} from "../shared/mappers";
import type { AppState } from "../use-app-store";

// Fire-and-forget image cache primer. The server hands back a 10-minute
// signed GET URL; if we wait until the user opens the detail-modal that
// URL is often expired and the download fails permanently. By calling
// this right after a row enters SQLite (sync, create, fetch) we cache
// while the URL is still valid. resolveImageUri is a no-op when a fresh
// cache entry already exists, so calling it per-row in fetchReadings
// stays cheap.
const prewarmImageCache = (uri: string | null | undefined): void => {
  if (!uri) return;
  if (!/^https?:\/\//i.test(uri)) return;
  void resolveImageUri(uri).catch(() => {});
};

// Mirror a server row into the SQLite cache. Best-effort: a failed write
// just means the row won't survive a kill before the next fetch — not a
// reason to bubble an error to the UI.
const cacheRemoteReading = async (
  userId: string,
  gql: ReadingGql,
): Promise<void> => {
  try {
    await upsertSyncedReading({
      userId,
      clientId: gql.clientId ?? null,
      remoteId: Number(gql.id),
      systolic: gql.systolic,
      diastolic: gql.diastolic,
      pulse: gql.pulse,
      measuredAt: new Date(gql.measuredAt).toISOString(),
      imageUri: gql.s3Key ?? null,
      notes: gql.notes ?? null,
      status: gql.status,
      createdAt: gql.createdAt
        ? new Date(gql.createdAt).toISOString()
        : new Date().toISOString(),
    });
    prewarmImageCache(gql.s3Key);
  } catch (error) {
    logWarn("Readings", "cacheRemoteReading failed", error, {
      remoteId: gql.id,
    });
  }
};

// Promise-based mutex: concurrent callers await the same in-flight sync
// instead of racing past a boolean flag and double-syncing.
let syncReadingsPromise: Promise<void> | null = null;

export interface ReadingsSlice {
  readings: BloodPressureReading[];
  alerts: AppAlert[];

  createReading: (input: {
    systolic: number;
    diastolic: number;
    pulse: number;
    measuredAt?: Date;
    imageUri?: string;
    notes?: string;
  }) => Promise<boolean>;
  deleteReading: (id: string) => Promise<void>;
  hydratePendingReadings: () => Promise<void>;
  syncPendingReadings: () => Promise<void>;
  fetchReadings: () => Promise<void>;
  fetchAlerts: () => Promise<void>;
  markAlertRead: (id: string) => Promise<void>;
  markAllAlertsRead: () => Promise<void>;
}

export const createReadingsSlice: StateCreator<
  AppState,
  [],
  [],
  ReadingsSlice
> = (set, get) => ({
  readings: [],
  alerts: [],

  fetchReadings: async () => {
    const token = get().authToken;
    const currentUser = get().user;
    if (!token) return;

    try {
      const data = await graphqlRequest<ReadingsQuery>(
        GQL_READINGS,
        { limit: 200, offset: 0 },
        token,
      );
      const remote = data.readings.map(readingFromGql);
      // Persist every server row into SQLite so reinstalls keep history
      // and the next launch can render offline. Best-effort; errors logged
      // inside cacheRemoteReading.
      if (currentUser) {
        for (const gql of data.readings) {
          await cacheRemoteReading(currentUser.id, gql);
        }
      }
      // Keep optimistic / queued rows that haven't reached the server yet —
      // those are identified by syncStatus, not by id prefix anymore.
      const pending = get().readings.filter(
        (r) => r.syncStatus && r.syncStatus !== "synced",
      );
      set({ readings: sortReadingsDesc([...pending, ...remote]) });
    } catch (error) {
      logWarn("Readings", "fetchReadings failed", error);
    }
  },

  fetchAlerts: async () => {
    const token = get().authToken;
    if (!token) return;

    try {
      const data = await graphqlRequest<AlertsQuery>(
        GQL_ALERTS,
        { limit: 100, offset: 0, unreadOnly: false },
        token,
      );
      set({ alerts: data.alerts.map(alertFromGql) });
    } catch (error) {
      logWarn("Alerts", "fetchAlerts failed", error);
    }
  },

  markAlertRead: async (id) => {
    const token = get().authToken;
    const now = new Date();
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === id ? { ...alert, readAt: alert.readAt ?? now } : alert,
      ),
    }));

    if (!token) return;

    try {
      await graphqlRequest(GQL_MARK_ALERT_READ, { id: Number(id) }, token);
    } catch (error) {
      logWarn(
        "Alerts",
        "markAlertRead failed; keeping optimistic state",
        error,
        { id },
      );
    }
  },

  markAllAlertsRead: async () => {
    const token = get().authToken;
    const now = new Date();
    set((state) => ({
      alerts: state.alerts.map((alert) => ({
        ...alert,
        readAt: alert.readAt ?? now,
      })),
    }));

    if (!token) return;

    try {
      await graphqlRequest(GQL_MARK_ALL_ALERTS_READ, undefined, token);
    } catch (error) {
      logWarn(
        "Alerts",
        "markAllAlertsRead failed; keeping optimistic state",
        error,
      );
    }
  },

  createReading: async (input) => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser) return false;

    const measuredAt = input.measuredAt ?? new Date();
    const systolic = Number(input.systolic);
    const diastolic = Number(input.diastolic);
    const pulse = Number(input.pulse);
    const status = getBPStatus(systolic, diastolic);
    const clientId = createClientId("reading", currentUser.id);
    let imageUri = input.imageUri;
    let imageReadyForRemote = !imageUri || /^https?:\/\//i.test(imageUri);

    if (get().isOnline && token && imageUri && !imageReadyForRemote) {
      try {
        imageUri = await uploadImageViaPresign({
          uri: imageUri,
          kind: "blood-pressure",
          token,
        });
        imageReadyForRemote = true;
      } catch (error) {
        console.warn(
          "[S3 upload] blood-pressure upload failed; keeping pending reading",
          error,
        );
        imageReadyForRemote = false;
      }
    }

    // Always insert into local pending first
    const pendingId = await insertPendingReading({
      userId: currentUser.id,
      clientId,
      syncStatus: imageReadyForRemote ? "pending" : "pending-image",
      systolic,
      diastolic,
      pulse,
      measuredAt: measuredAt.toISOString(),
      imageUri: imageUri ?? null,
      notes: input.notes ?? null,
      status,
      createdAt: new Date().toISOString(),
    });

    if (pendingId) {
      const localReading: BloodPressureReading = {
        id: toLocalReadingId(pendingId),
        userId: currentUser.id,
        clientId,
        systolic,
        diastolic,
        pulse,
        measuredAt,
        imageUri,
        notes: input.notes,
        status,
        createdAt: new Date(),
        syncStatus: imageReadyForRemote ? "pending" : "pending-image",
      };
      set((state) => ({
        readings: sortReadingsDesc([localReading, ...state.readings]),
      }));
    }

    if (!get().isOnline || !token) return Boolean(pendingId);
    if (!imageReadyForRemote) return Boolean(pendingId);

    try {
      const result = await graphqlRequest<CreateReadingMutation>(
        GQL_CREATE_READING,
        {
          input: {
            systolic,
            diastolic,
            pulse,
            status,
            measuredAt: measuredAt.toISOString(),
            clientId,
            // Server's `CreateReadingInput` accepts `s3Key` (was renamed from
            // `imageUri` in schema PR B). The local SQLite column stays
            // `imageUri` — translation happens only at the GraphQL boundary.
            s3Key: imageUri ?? null,
            notes: input.notes ?? null,
          },
        },
        token,
      );
      const remote = result.createReading;
      const remoteReading = readingFromGql(remote);
      if (pendingId) {
        // Promote the pending row to synced (keep it in the cache) rather
        // than delete + refetch — keeps offline history intact across kills.
        await markReadingSynced(
          pendingId,
          Number(remote.id),
          remote.s3Key ?? null,
        );
        prewarmImageCache(remote.s3Key);
        set((state) => ({
          readings: sortReadingsDesc(
            state.readings.map((r) =>
              r.id === toLocalReadingId(pendingId) ? remoteReading : r,
            ),
          ),
        }));
      } else {
        // No pending row was created (web / SQLite unavailable) — fall back
        // to direct cache write so refetch on this device still works.
        await cacheRemoteReading(currentUser.id, remote);
        set((state) => ({
          readings: sortReadingsDesc([remoteReading, ...state.readings]),
        }));
      }
      void get().fetchAlerts();
      return true;
    } catch (error) {
      logWarn(
        "Readings",
        "createReading remote failed; kept as pending",
        error,
        { clientId },
      );
      return Boolean(pendingId);
    }
  },

  deleteReading: async (id) => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser) return;

    if (isLocalReadingId(id)) {
      const localId = parseLocalReadingId(id);
      if (!Number.isNaN(localId)) await deletePendingReading(localId);
      set((state) => ({
        readings: state.readings.filter((r) => r.id !== id),
      }));
      return;
    }

    if (token) {
      try {
        await graphqlRequest(GQL_DELETE_READING, { id: Number(id) }, token);
      } catch (error) {
        logWarn("Readings", "deleteReading remote failed", error, { id });
      }
    }
    // Also evict the row from the local mirror so it doesn't reappear on
    // next hydrate. Server delete already gone through above (or failed —
    // either way we trust the UI intent here).
    const remoteIdNum = Number(id);
    if (Number.isFinite(remoteIdNum)) {
      await deleteSyncedReadingByRemoteId(currentUser.id, remoteIdNum);
    }
    set((state) => ({
      readings: state.readings.filter((r) => r.id !== id),
    }));
  },

  // Loads every locally-cached reading (pending queue + synced mirror) so
  // the UI has history on first frame, before fetchReadings round-trips.
  hydratePendingReadings: async () => {
    const currentUser = get().user;
    if (!currentUser) return;
    const rows = await listLocalReadings(currentUser.id);
    const localReadings = rows.map(readingFromRow);
    // Drop everything else in state — local cache is the source of truth
    // until fetchReadings reconciles. Any in-memory ghost rows from another
    // user/session would otherwise leak through.
    set({ readings: sortReadingsDesc(localReadings) });
  },

  syncPendingReadings: async () => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser || !token || !get().isOnline) return;
    if (syncReadingsPromise) return syncReadingsPromise;

    syncReadingsPromise = (async () => {
      try {
        const pending = await listPendingReadings(currentUser.id);
        for (const row of pending) {
          try {
            let imageUri = row.imageUri ?? null;
            if (imageUri && !/^https?:\/\//i.test(imageUri)) {
              try {
                imageUri = await uploadImageViaPresign({
                  uri: imageUri,
                  kind: "blood-pressure",
                  token,
                });
              } catch (error) {
                if (!(error instanceof LocalImageMissingError)) throw error;
                logWarn(
                  "Sync",
                  "local image missing for pending reading; syncing BP values without image",
                  error,
                  { localId: row.id, clientId: row.clientId, uri: imageUri },
                );
                imageUri = null;
              }
            }

            const result = await graphqlRequest<CreateReadingMutation>(
              GQL_CREATE_READING,
              {
                input: {
                  systolic: row.systolic,
                  diastolic: row.diastolic,
                  pulse: row.pulse,
                  status: row.status,
                  measuredAt: row.measuredAt,
                  clientId:
                    row.clientId || `local-${currentUser.id}-${row.id}`,
                  s3Key: imageUri,
                  notes: row.notes ?? null,
                },
              },
              token,
            );
            const remote = result.createReading;
            const remoteReading = readingFromGql(remote);
            await markReadingSynced(
              row.id,
              Number(remote.id),
              remote.s3Key ?? null,
            );
            prewarmImageCache(remote.s3Key);
            set((state) => ({
              readings: sortReadingsDesc(
                state.readings.map((r) =>
                  r.id === toLocalReadingId(row.id) ? remoteReading : r,
                ),
              ),
            }));
          } catch (error) {
            logWarn(
              "Sync",
              "pending blood-pressure reading failed; will retry later",
              error,
              { localId: row.id, clientId: row.clientId },
            );
          }
        }
        void get().fetchAlerts();
      } finally {
        syncReadingsPromise = null;
      }
    })();

    return syncReadingsPromise;
  },
});
