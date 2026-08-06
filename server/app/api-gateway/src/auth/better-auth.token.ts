import { Inject } from '@nestjs/common';

/**
 * DI token for the Better Auth instance.
 *
 * Deliberately in its own file with no `better-auth` import: the package is
 * ESM-only, and anything that pulls it in transitively cannot be loaded by the
 * CommonJS unit-test runner. Consumers that only need the token — the guard,
 * the service, and their specs — import from here.
 */
export const BETTER_AUTH = 'BETTER_AUTH';

export const InjectBetterAuth = () => Inject(BETTER_AUTH);
