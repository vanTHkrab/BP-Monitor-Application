import {
  GQL_ADD_CAREGIVER_PATIENT,
  GQL_CAREGIVER_LINKS,
  GQL_REMOVE_CAREGIVER_PATIENT,
  graphqlRequest,
} from "@/constants/api";
import { CaregiverLink } from "@/types";
import type {
  AddCaregiverPatientMutation,
  CaregiverLinksQuery,
  RemoveCaregiverPatientMutation,
} from "@/types/graphql";
import { errorMessage } from "@/types/graphql";
import type { StateCreator } from "zustand";
import { authErrorToThai } from "../shared/error-format";
import { logWarn } from "../shared/log";
import { caregiverLinkFromGql } from "../shared/mappers";
import type { AppState } from "../use-app-store";

export interface CaregiversSlice {
  caregiverLinks: CaregiverLink[];

  fetchCaregiverLinks: () => Promise<void>;
  addCaregiverPatient: (input: {
    patientPhone: string;
    relationship: string;
  }) => Promise<boolean>;
  removeCaregiverPatient: (input: {
    caregiverId: string;
    patientId: string;
  }) => Promise<boolean>;
}

export const createCaregiversSlice: StateCreator<
  AppState,
  [],
  [],
  CaregiversSlice
> = (set, get) => ({
  caregiverLinks: [],

  fetchCaregiverLinks: async () => {
    const token = get().authToken;
    if (!token) return;

    try {
      const data = await graphqlRequest<CaregiverLinksQuery>(
        GQL_CAREGIVER_LINKS,
        undefined,
        token,
      );
      set({
        caregiverLinks: data.caregiverLinks.map(caregiverLinkFromGql),
      });
    } catch (error) {
      logWarn("Caregivers", "fetchCaregiverLinks failed", error);
    }
  },

  addCaregiverPatient: async ({ patientPhone, relationship }) => {
    const token = get().authToken;
    if (!token) return false;

    try {
      const data = await graphqlRequest<AddCaregiverPatientMutation>(
        GQL_ADD_CAREGIVER_PATIENT,
        {
          patientPhone: patientPhone.trim(),
          relationship: relationship.trim() || "caregiver",
        },
        token,
      );
      const link = caregiverLinkFromGql(data.addCaregiverPatient);
      set((state) => ({
        caregiverLinks: [
          link,
          ...state.caregiverLinks.filter(
            (item) =>
              item.caregiverId !== link.caregiverId ||
              item.patientId !== link.patientId,
          ),
        ],
      }));
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "caregiver/add-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  removeCaregiverPatient: async ({ caregiverId, patientId }) => {
    const token = get().authToken;
    if (!token) return false;

    try {
      const data = await graphqlRequest<RemoveCaregiverPatientMutation>(
        GQL_REMOVE_CAREGIVER_PATIENT,
        { caregiverId, patientId },
        token,
      );
      if (!data.removeCaregiverPatient) return false;

      set((state) => ({
        caregiverLinks: state.caregiverLinks.filter(
          (link) =>
            link.caregiverId !== caregiverId || link.patientId !== patientId,
        ),
      }));
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "caregiver/remove-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },
});
