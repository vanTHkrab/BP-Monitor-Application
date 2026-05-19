import type { StateCreator } from "zustand";
import type { AppState } from "../use-app-store";

export interface NetworkSlice {
  isOnline: boolean;
  setNetworkStatus: (isOnline: boolean) => void;
}

export const createNetworkSlice: StateCreator<
  AppState,
  [],
  [],
  NetworkSlice
> = (set) => ({
  isOnline: true,
  setNetworkStatus: (isOnline) => set({ isOnline }),
});
