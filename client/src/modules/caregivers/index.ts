/**
 * Public surface of the caregivers module. Screens import from here, never
 * from a file inside — same rule as `modules/auth` and `modules/security`.
 *
 * `services/*` stays unexported: a screen calling the GraphQL layer directly
 * would skip the query invalidation the hooks own, and an accepted invite
 * that still renders as "รอตอบรับ" is exactly the kind of bug that makes
 * someone accept twice.
 */
export { registerActivePatientReset } from './bootstrap';
export {
  resetActivePatient,
  useActivePatient,
  useActivePatientStore,
} from './hooks/use-active-patient';
export { useSubject, type Subject } from './hooks/use-subject';
export {
  useCaregiverLinks,
  useInvitePatient,
  useMyPatients,
  useProfileChangeLog,
  useRemoveCaregiverLink,
  useRespondToInvite,
  useUpdateCaregiverPermission,
  useUpdatePatientHealth,
} from './hooks/use-caregivers';

export {
  DEFAULT_RELATIONSHIP,
  RELATIONSHIP_OPTIONS,
  parseRelationship,
  relationshipLabel,
} from './lib/relationship';
export { deriveSections, isEmpty, linkKey, type CaregiverSections } from './lib/sections';

export { ActivePatientBanner } from './components/active-patient-banner';
export { CompactPatientBanner } from './components/compact-patient-banner';
export {
  PatientSwitcherSheet,
  sortByAttention,
} from './components/patient-switcher-sheet';
export { InviteDecisionCard } from './components/invite-decision-card';
export { PermissionSheet } from './components/permission-sheet';
export { PERMISSION_OPTIONS, canEditPatientHealth, permissionLabel } from './lib/permission';
export { HEALTH_VALUE_EMPTY, formatHealthValue, healthFieldLabel } from './lib/health-fields';
/*
 * The form helpers are exported; `HEALTH_FIELDS` and the diff are what keep
 * the mutation to five fields, so a screen must not be able to assemble an
 * `UpdatePatientHealthInput` by hand. `changedHealthFields` is the only
 * supported way to build one — see `lib/health-form.ts`.
 */
export {
  changedHealthFields,
  hasHealthChanges,
  healthFormFromPatient,
  validateHealthForm,
  type HealthBaseline,
  type HealthErrors,
  type HealthForm,
} from './lib/health-form';
export { ChangeLogEntryRow } from './components/change-log-entry';
export { InviteForm } from './components/invite-form';
export { LinkGroup, LinkRow } from './components/link-row';
export { PersonCard } from './components/person-card';
export { RelationshipPicker } from './components/relationship-picker';
export { useInviteAlerts } from './hooks/use-invite-alerts';

export type {
  CaregiverPermission,
  HealthFieldName,
  PatientHealthProfile,
  ProfileChangeLogEntry,
  UpdatePatientHealthInput,
  PatientLatestReading,
  CaregiverLink,
  CaregiverLinkStatus,
  InvitePatientInput,
  PatientSummary,
  RelationshipType,
} from './types';
