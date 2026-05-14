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
  insertPendingReading,
  listPendingReadings,
} from "@/data/local-db";
import { AppAlert, BloodPressureReading } from "@/types";
import type { AlertsQuery, ReadingsQuery } from "@/types/graphql";
import { uploadImageViaPresign } from "@/utils/upload-image";
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
  readingFromPending,
  sortReadingsDesc,
} from "../shared/mappers";
import type { AppState } from "../use-app-store";

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
    if (!token) return;

    try {
      const data = await graphqlRequest<ReadingsQuery>(
        GQL_READINGS,
        { limit: 200, offset: 0 },
        token,
      );
      const remote = data.readings.map(readingFromGql);
      const pending = get().readings.filter((r) => isLocalReadingId(r.id));
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
      };
      set((state) => ({
        readings: sortReadingsDesc([localReading, ...state.readings]),
      }));
    }

    if (!get().isOnline || !token) return Boolean(pendingId);
    if (!imageReadyForRemote) return Boolean(pendingId);

    try {
      await graphqlRequest(
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
      if (pendingId) {
        await deletePendingReading(pendingId);
        set((state) => ({
          readings: state.readings.filter(
            (r) => r.id !== toLocalReadingId(pendingId),
          ),
        }));
      }
      void get().fetchReadings();
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
    set((state) => ({
      readings: state.readings.filter((r) => r.id !== id),
    }));
  },

  hydratePendingReadings: async () => {
    const currentUser = get().user;
    if (!currentUser) return;
    const pending = await listPendingReadings(currentUser.id);
    const pendingReadings = pending.map(readingFromPending);
    set((state) => {
      const nonLocal = state.readings.filter((r) => !isLocalReadingId(r.id));
      return {
        readings: sortReadingsDesc([...pendingReadings, ...nonLocal]),
      };
    });
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
              imageUri = await uploadImageViaPresign({
                uri: imageUri,
                kind: "blood-pressure",
                token,
              });
            }

            await graphqlRequest(
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
            await deletePendingReading(row.id);
            set((state) => ({
              readings: state.readings.filter(
                (r) => r.id !== toLocalReadingId(row.id),
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
        void get().fetchReadings();
        void get().fetchAlerts();
      } finally {
        syncReadingsPromise = null;
      }
    })();

    return syncReadingsPromise;
  },
});
