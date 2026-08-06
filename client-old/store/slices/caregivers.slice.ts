import {
  GQL_ADD_CAREGIVER_PATIENT,
  GQL_CAREGIVER_LINKS,
  GQL_MY_PATIENTS,
  GQL_PENDING_INVITES,
  GQL_REMOVE_CAREGIVER_PATIENT,
  GQL_RESPOND_INVITE,
  graphqlRequest,
} from "@/constants/api";
import { CaregiverLink, PatientSummary } from "@/types";
import type {
  AddCaregiverPatientMutation,
  CaregiverLinksQuery,
  MyPatientsQuery,
  MyPendingInvitesQuery,
  RemoveCaregiverPatientMutation,
  RespondToCaregiverInviteMutation,
} from "@/types/graphql";
import { errorMessage } from "@/types/graphql";
import type { StateCreator } from "zustand";
import { authErrorToThai } from "../shared/error-format";
import { logWarn } from "../shared/log";
import {
  caregiverLinkFromGql,
  patientSummaryFromGql,
} from "../shared/mappers";
import type { AppState } from "../use-app-store";

export interface CaregiversSlice {
  caregiverLinks: CaregiverLink[];
  myPatients: PatientSummary[];
  pendingInvites: CaregiverLink[];

  fetchCaregiverLinks: () => Promise<void>;
  fetchMyPatients: () => Promise<void>;
  fetchPendingInvites: () => Promise<void>;
  addCaregiverPatient: (input: {
    patientPhone: string;
    relationship: string;
  }) => Promise<boolean>;
  respondToInvite: (input: {
    caregiverId: string;
    accept: boolean;
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
  myPatients: [],
  pendingInvites: [],

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

  fetchMyPatients: async () => {
    const token = get().authToken;
    if (!token) return;

    try {
      const data = await graphqlRequest<MyPatientsQuery>(
        GQL_MY_PATIENTS,
        undefined,
        token,
      );
      set({ myPatients: data.myPatients.map(patientSummaryFromGql) });
    } catch (error) {
      logWarn("Caregivers", "fetchMyPatients failed", error);
    }
  },

  fetchPendingInvites: async () => {
    const token = get().authToken;
    if (!token) return;

    try {
      const data = await graphqlRequest<MyPendingInvitesQuery>(
        GQL_PENDING_INVITES,
        undefined,
        token,
      );
      set({
        pendingInvites: data.myPendingInvites.map(caregiverLinkFromGql),
      });
    } catch (error) {
      logWarn("Caregivers", "fetchPendingInvites failed", error);
    }
  },

  respondToInvite: async ({ caregiverId, accept }) => {
    const token = get().authToken;
    if (!token) return false;

    try {
      const data = await graphqlRequest<RespondToCaregiverInviteMutation>(
        GQL_RESPOND_INVITE,
        { caregiverId, accept },
        token,
      );
      const updated = caregiverLinkFromGql(data.respondToCaregiverInvite);
      set((state) => ({
        // The invite has been answered; drop it from the pending list.
        pendingInvites: state.pendingInvites.filter(
          (link) => link.caregiverId !== updated.caregiverId,
        ),
        // Mirror the updated status into caregiverLinks so the patient
        // screen sees "accepted/rejected" without an extra fetch.
        caregiverLinks: [
          updated,
          ...state.caregiverLinks.filter(
            (link) =>
              link.caregiverId !== updated.caregiverId ||
              link.patientId !== updated.patientId,
          ),
        ],
      }));
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "caregiver/respond-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
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
