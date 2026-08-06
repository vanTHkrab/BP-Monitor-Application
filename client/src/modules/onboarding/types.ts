/**
 * Roles a user may pick for themselves. Mirrors the gateway's
 * `UserRoleInput` enum (`patient | caregiver`) — `developer` is deliberately
 * absent there and must stay absent here.
 */
export type SelectableRole = 'patient' | 'caregiver';

export const SELECTABLE_ROLES: readonly SelectableRole[] = ['patient', 'caregiver'];
