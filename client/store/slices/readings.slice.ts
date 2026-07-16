import {
  GQL_ALERTS,
  GQL_CREATE_READING,
  GQL_DELETE_READING,
  GQL_MARK_ALERT_READ,
  GQL_MARK_ALL_ALERTS_READ,
  GQL_READINGS,
  graphqlRequest,
} from "@/constants/api";
import { getBPStatus } from "@/constants/colors";
import {
  deletePendingReading,
  deleteSyncedReadingByRemoteId,
  insertPendingReading,
  listLocalReadings,
  listPendingReadings,
  markReadingSynced,
  updatePendingReadingImage,
  upsertSyncedReading,
} from "@/data/local-db";
import { AppAlert, BloodPressureReading } from "@/types";
import type {
  AlertsQuery,
  CreateReadingMutation,
  ReadingGql,
  ReadingsQuery,
} from "@/types/graphql";
import { resolveImageUri } from "@/utils/image-cache";
import {
  deletePendingImageForClientId,
  persistPendingImage,
} from "@/utils/pending-image-store";
import { LocalImageMissingError, uploadImageViaPresign } from "@/utils/upload-image";
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
      // Synced mirror rows don't need the local imageId — the server
      // owns the Image↔Reading FK after the create. Leaving it null
      // also prevents stale ids from leaking into a future re-sync.
      imageId: null,
      notes: gql.notes ?? null,
      status: gql.status,
      createdAt: gql.createdAt
        ? new Date(gql.createdAt).toISOString()
        : new Date().toISOString(),
      // Caregiver attribution — persisted so "บันทึกโดย ..." captions
      // survive offline launches. Null ⇒ patient entered it themselves.
      recordedById: gql.recordedBy ? String(gql.recordedBy.id) : null,
      recordedByName: gql.recordedBy
        ? `${gql.recordedBy.firstname} ${gql.recordedBy.lastname}`.trim()
        : null,
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
    /** When the caller has already uploaded the image (camera analysis
     *  flow) and holds the server-minted Image.id, pass it through so
     *  the gateway attaches the new reading to that Image row via FK
     *  — see Image-as-base-model refactor PR1/PR2. Manual entries omit
     *  this; the store uploads first and captures the id internally. */
    imageId?: number;
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
        { limit: 200, offset: 0, patientId: get().activePatientId ?? undefined },
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

    // ── Caregiver mode: save on behalf of the active patient ──
    // The reading must be attributed to the patient, not the caregiver, so
    // the mutation input carries `patientId` (the write-side counterpart of
    // the `readings(patientId:)` query contract; the gateway authorizes the
    // caregiver-patient link server-side). This path is online-only by
    // design: `pending_readings` rows have no target-patient column and the
    // sync loop replays them under the logged-in user's id, so queueing here
    // would silently mis-attribute the reading on a later sync (or after the
    // caregiver switches patients). Failing fast keeps the queue clean.
    if (currentUser.role === "caregiver") {
      const patientId = get().activePatientId;
      if (!patientId) {
        logWarn("Readings", "caregiver createReading without active patient");
        return false;
      }
      if (!get().isOnline || !token) {
        logWarn(
          "Readings",
          "caregiver createReading requires an online session",
          undefined,
          { isOnline: get().isOnline },
        );
        return false;
      }
      try {
        let imageId: number | null = input.imageId ?? null;
        // Camera analysis flow pre-uploads and passes imageId; a caregiver
        // save with a still-local image uses the same presign path as the
        // patient flow. Upload failure fails the whole save — no queue row.
        if (imageId == null && input.imageUri && !/^https?:\/\//i.test(input.imageUri)) {
          const uploaded = await uploadImageViaPresign({
            uri: input.imageUri,
            kind: "blood-pressure",
            token,
          });
          imageId = uploaded.imageId;
        }
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
              imageId,
              notes: input.notes ?? null,
              patientId,
            },
          },
          token,
        );
        // The actor is the logged-in caregiver, so attribution is known
        // client-side. The gateway echoes ``recordedBy`` on createReading;
        // the fallback keeps the label (and the SQLite mirror) correct
        // even if a response omits it, without waiting for a refetch.
        const remote: typeof result.createReading = {
          ...result.createReading,
          recordedBy: result.createReading.recordedBy ?? {
            id: currentUser.id,
            firstname: currentUser.firstname,
            lastname: currentUser.lastname,
          },
        };
        const remoteReading = readingFromGql(remote);
        // Mirror into the caregiver's local cache — consistent with how
        // fetchReadings mirrors the patient rows viewed in caregiver mode.
        await cacheRemoteReading(currentUser.id, remote);
        set((state) => ({
          readings: sortReadingsDesc([remoteReading, ...state.readings]),
        }));
        void get().fetchAlerts();
        return true;
      } catch (error) {
        logWarn("Readings", "caregiver createReading failed", error, {
          clientId,
          patientId,
        });
        return false;
      }
    }

    let imageUri = input.imageUri;
    // ``imageId`` is non-null in two cases: caller pre-uploaded
    // (camera analysis save flow), or this function uploaded just below
    // and captured the id. Either way, the gateway only accepts
    // ``imageId`` now (Image-as-base-model PR2) — ``s3Key`` is gone.
    let imageId: number | null = input.imageId ?? null;
    let imageReadyForRemote =
      !imageUri || /^https?:\/\//i.test(imageUri);

    if (get().isOnline && token && imageUri && !imageReadyForRemote) {
      try {
        const uploaded = await uploadImageViaPresign({
          uri: imageUri,
          kind: "blood-pressure",
          token,
        });
        imageUri = uploaded.url;
        imageId = uploaded.imageId;
        imageReadyForRemote = true;
      } catch (error) {
        console.warn(
          "[S3 upload] blood-pressure upload failed; keeping pending reading",
          error,
        );
        imageReadyForRemote = false;
      }
    }

    // The reading is being queued with a still-local image (offline, or the
    // upload above failed). The capture / image-manipulator output lives in
    // OS *cache* storage which can be evicted before the queue drains — copy
    // it into durable document storage keyed by clientId so a delayed sync
    // still finds the bytes. Falls back to the original cache URI on copy
    // failure (never blocks the save); deleted again after markReadingSynced
    // or by the app-launch orphan sweep.
    if (imageUri && !imageReadyForRemote) {
      imageUri = await persistPendingImage(imageUri, clientId);
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
      imageId,
      notes: input.notes ?? null,
      status,
      createdAt: new Date().toISOString(),
      // Patient self-entry — no attribution. The caregiver path above
      // never queues, so pending rows are always the owner's own entries.
      recordedById: null,
      recordedByName: null,
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
            // Server's ``CreateReadingInput`` takes ``imageId`` (the
            // Image row minted by ``confirmImageUpload``); ``s3Key``
            // was removed in the Image-as-base-model refactor. Manual
            // entries omit imageUri entirely, so imageId stays null.
            imageId,
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
          remote.clientId ?? clientId,
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
      // Grab the clientId before the row leaves state so the durable photo
      // copy (if the queued reading had one) is released with it.
      const localClientId = get().readings.find((r) => r.id === id)?.clientId;
      if (!Number.isNaN(localId)) await deletePendingReading(localId);
      void deletePendingImageForClientId(localClientId);
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
            // Resume from a half-completed sync: if the previous attempt
            // confirmed the upload (imageId set) but the create mutation
            // failed, skip re-upload — that would mint a second Image row
            // and orphan the first in S3.
            let imageId: number | null = row.imageId ?? null;
            if (imageUri && !/^https?:\/\//i.test(imageUri) && imageId == null) {
              try {
                const uploaded = await uploadImageViaPresign({
                  uri: imageUri,
                  kind: "blood-pressure",
                  token,
                });
                imageUri = uploaded.url;
                imageId = uploaded.imageId;
                // Persist before the mutation so a crash here doesn't
                // re-upload on the next sync. updatePendingReadingImage
                // also flips syncStatus from 'pending-image' → 'pending'.
                await updatePendingReadingImage(row.id, { imageUri, imageId });
              } catch (error) {
                if (!(error instanceof LocalImageMissingError)) throw error;
                logWarn(
                  "Sync",
                  "local image missing for pending reading; syncing BP values without image",
                  error,
                  { localId: row.id, clientId: row.clientId, uri: imageUri },
                );
                imageUri = null;
                imageId = null;
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
                  imageId,
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
              remote.clientId ?? row.clientId,
            );
            prewarmImageCache(remote.s3Key);
            // Row is confirmed server-side — drop the durable photo copy
            // keyed to this clientId. Keying by clientId (not row.imageUri)
            // also covers the resume case where a previous pass already
            // replaced imageUri with the uploaded https URL. Best-effort;
            // the app-launch orphan sweep catches anything missed here.
            void deletePendingImageForClientId(row.clientId);
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
