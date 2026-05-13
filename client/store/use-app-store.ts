import { create } from "zustand";
import { type AuthSlice, createAuthSlice } from "./slices/auth.slice";
import {
  type CaregiversSlice,
  createCaregiversSlice,
} from "./slices/caregivers.slice";
import {
  type CommunitySlice,
  createCommunitySlice,
} from "./slices/community.slice";
import { type NetworkSlice, createNetworkSlice } from "./slices/network.slice";
import {
  type PreferencesSlice,
  createPreferencesSlice,
} from "./slices/preferences.slice";
import {
  type ReadingsSlice,
  createReadingsSlice,
} from "./slices/readings.slice";

export type AppState = AuthSlice &
  ReadingsSlice &
  CommunitySlice &
  CaregiversSlice &
  PreferencesSlice &
  NetworkSlice;

export const useAppStore = create<AppState>()((...a) => ({
  ...createAuthSlice(...a),
  ...createReadingsSlice(...a),
  ...createCommunitySlice(...a),
  ...createCaregiversSlice(...a),
  ...createPreferencesSlice(...a),
  ...createNetworkSlice(...a),
}));
