/**
 * Public surface of the caregivers module. Screens import from here, never
 * from a file inside — same rule as `modules/auth` and `modules/security`.
 *
 * `services/*` stays unexported: a screen calling the GraphQL layer directly
 * would skip the query invalidation the hooks own, and an accepted invite
 * that still renders as "รอตอบรับ" is exactly the kind of bug that makes
 * someone accept twice.
 */
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
  useRemoveCaregiverLink,
  useRespondToInvite,
} from './hooks/use-caregivers';

export {
  DEFAULT_RELATIONSHIP,
  RELATIONSHIP_OPTIONS,
  parseRelationship,
  relationshipLabel,
} from './lib/relationship';
export { deriveSections, isEmpty, linkKey, type CaregiverSections } from './lib/sections';

export { ActivePatientBanner } from './components/active-patient-banner';
export { InviteDecisionCard } from './components/invite-decision-card';
export { InviteForm } from './components/invite-form';
export { LinkGroup, LinkRow } from './components/link-row';
export { RelationshipPicker } from './components/relationship-picker';

export type {
  CaregiverLink,
  CaregiverLinkStatus,
  InvitePatientInput,
  PatientSummary,
  RelationshipType,
} from './types';
