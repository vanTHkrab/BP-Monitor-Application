import { graphqlRequest } from "@/src/core/graphql/client";
import {
    GQL_ME,
    GQL_UPDATE_PROFILE,
} from "@/src/core/graphql/operations";
import {
    deletePendingAvatarUpload,
    getPendingAvatarUpload,
    upsertPendingAvatarUpload,
} from "@/src/data/queries/avatars";
import { User } from "@/src/types";
import type {
    MeQuery,
    UpdateProfileMutation,
} from "@/src/types/graphql";
import { uploadImageViaPresign } from "@/src/utils/upload-image";
import type { StateCreator } from "zustand";
import { logWarn } from "../shared/log";
import { userFromGql } from "../shared/mappers";
import type { AppState } from "../use-app-store";

// Promise-based mutex matching the readings/posts sync pattern. Concurrent
// callers (NetInfo edge, AppState change, manual save) all await the same
// in-flight upload instead of racing past a boolean flag.
let syncAvatarPromise: Promise<void> | null = null;

export interface ProfileSlice {
  updateMyProfile: (input: {
    firstname?: string;
    lastname?: string;
    phone?: string;
    email?: string;
    dob?: string;
    gender?: User["gender"];
    weight?: number;
    height?: number;
    congenitalDisease?: string;
    avatar?: string;
  }) => Promise<boolean>;
  fetchMyProfile: () => Promise<boolean>;
  /**
   * Queue an avatar pick for upload. Updates `user.avatar` to the local URI
   * immediately (optimistic) and persists a row in `pending_avatar_uploads`
   * so the choice survives an app kill. Returns `true` once the queue write
   * succeeds — the actual S3 upload runs asynchronously via
   * `syncPendingAvatar`. Caller does not need to await network success.
   */
  uploadMyAvatar: (avatarUri: string) => Promise<boolean>;
  /** Restore optimistic avatar state from SQLite on app start. */
  hydratePendingAvatar: () => Promise<void>;
  /** Flush the queued avatar to S3 + gateway; safe to call concurrently. */
  syncPendingAvatar: () => Promise<void>;
}

export const createProfileSlice: StateCreator<
  AppState,
  [],
  [],
  ProfileSlice
> = (set, get) => ({
  updateMyProfile: async (input) => {
    const token = get().authToken;
    if (!token || !get().user) return false;

    try {
      const data = await graphqlRequest<UpdateProfileMutation>(
        GQL_UPDATE_PROFILE,
        { input },
        token,
      );
      set({ user: userFromGql(data.updateProfile) });
      return true;
    } catch (error) {
      logWarn("Profile", "updateMyProfile failed", error);
      return false;
    }
  },

  fetchMyProfile: async () => {
    const token = get().authToken;
    if (!token) return false;

    try {
      const data = await graphqlRequest<MeQuery>(GQL_ME, undefined, token);
      const serverUser = userFromGql(data.me);
      // Re-focus pulls `me` from the server. If the user picked a new avatar
      // while offline (or even just seconds ago — the sync runs async), the
      // pending queue still holds the local URI. Keep showing that local URI
      // until the sync actually completes; otherwise the picked photo
      // visibly flickers back to the stale one.
      const pending = await getPendingAvatarUpload(serverUser.id);
      set({
        user: pending ? { ...serverUser, avatar: pending.localUri } : serverUser,
      });
      return true;
    } catch (error) {
      logWarn("Profile", "fetchMyProfile failed", error);
      return false;
    }
  },

  uploadMyAvatar: async (avatarUri) => {
    const currentUser = get().user;
    if (!currentUser) return false;

    // Short-circuit: if the URI is already a remote URL (e.g. caller passed
    // the server's canonical URL back through), just persist via the normal
    // updateProfile path with no queue churn.
    if (/^https?:\/\//i.test(avatarUri)) {
      const token = get().authToken;
      if (!token) return false;
      try {
        const data = await graphqlRequest<UpdateProfileMutation>(
          GQL_UPDATE_PROFILE,
          { input: { avatar: avatarUri } },
          token,
        );
        set({ user: userFromGql(data.updateProfile) });
        return true;
      } catch (error) {
        logWarn("Profile", "uploadMyAvatar remote-set failed", error);
        return false;
      }
    }

    // Optimistic: reflect the picked URI in the store immediately so every
    // <Image source={{ uri: user.avatar }}> renders the new photo without
    // waiting for S3.
    set({ user: { ...currentUser, avatar: avatarUri } });

    try {
      await upsertPendingAvatarUpload({
        userId: currentUser.id,
        localUri: avatarUri,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      logWarn("Profile", "queue avatar upload failed", error);
      // Queue write failure means SQLite is broken; the in-memory optimistic
      // state will still let the UI render the picked photo for this session.
    }

    // Fire-and-forget sync; the mutex makes this safe to call from anywhere.
    void get().syncPendingAvatar();
    return true;
  },

  hydratePendingAvatar: async () => {
    const currentUser = get().user;
    if (!currentUser) return;
    try {
      const row = await getPendingAvatarUpload(currentUser.id);
      if (!row) return;
      // Override the server-side avatar with the local URI so the UI shows
      // the picked photo even before sync completes.
      set({ user: { ...currentUser, avatar: row.localUri } });
    } catch (error) {
      logWarn("Profile", "hydratePendingAvatar failed", error);
    }
  },

  syncPendingAvatar: async () => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser || !token || !get().isOnline) return;
    if (syncAvatarPromise) return syncAvatarPromise;

    syncAvatarPromise = (async () => {
      try {
        const row = await getPendingAvatarUpload(currentUser.id);
        if (!row) return;

        try {
          const uploadedAvatarUri = await uploadImageViaPresign({
            uri: row.localUri,
            kind: "profile",
            token,
          });
          const data = await graphqlRequest<UpdateProfileMutation>(
            GQL_UPDATE_PROFILE,
            { input: { avatar: uploadedAvatarUri } },
            token,
          );
          await deletePendingAvatarUpload(currentUser.id);
          set({ user: userFromGql(data.updateProfile) });
        } catch (error) {
          logWarn(
            "Sync",
            "pending avatar upload failed; will retry later",
            error,
            { userId: currentUser.id },
          );
        }
      } finally {
        syncAvatarPromise = null;
      }
    })();

    return syncAvatarPromise;
  },
});
