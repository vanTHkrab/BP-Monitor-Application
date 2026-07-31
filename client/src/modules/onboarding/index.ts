/**
 * Public surface of the onboarding module.
 *
 * `services/*` stays internal: a screen calling the API directly would skip
 * the `me` cache write the hook owns, and the gate would then bounce the
 * user back into the step they just finished.
 */
export { useSelectRole } from './hooks/use-select-role';
export { useOnboardingState } from './hooks/use-onboarding-state';
export { SELECTABLE_ROLES } from './types';
export type { SelectableRole } from './types';
