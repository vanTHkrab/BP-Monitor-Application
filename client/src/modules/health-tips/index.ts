/**
 * Public surface of the health-tips module. The screen imports from here,
 * never from a file inside — same rule as the other modules.
 */
export { HEALTH_TIPS, resolveTipIcon } from './lib/tips';
export type { HealthTip, HealthTipIcon, HealthTipIconKey } from './types';
