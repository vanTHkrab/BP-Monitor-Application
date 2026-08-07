/// <reference types="jest" />
/**
 * `DebugResolver` — one query, and the only two things that can go wrong
 * with it are which identity it passes down and whether it is guarded.
 *
 * The guard here is declared at the **class** level, not on the method, so a
 * helper that reads only prototype-method metadata reports "no guards" and
 * still passes a `toHaveLength(0)`-style assertion. `guardsOn` below reads
 * both, which is what Nest actually merges at request time.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
// Deep imports, deliberately. `@Args` records its metadata under
// `PARAM_ARGS_METADATA` on the resolver *constructor*, keyed
// `"<GqlParamtype>:<paramIndex>"` — and neither the key nor the enum is
// re-exported from the package root. Both are pinned to @nestjs/graphql 13;
// the calibration assertion in `declares no @Args…` below fails loudly if a
// version bump changes the shape, rather than silently reporting "no args".
import { PARAM_ARGS_METADATA } from '@nestjs/graphql/dist/graphql.constants';
import { GqlParamtype } from '@nestjs/graphql/dist/enums/gql-paramtype.enum';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { GqlAuthGuard } from '../auth/auth.guard';
import { DebugResolver } from './debug.resolver';
import { DebugService } from './debug.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const makeResolver = () => {
  const debugService = {
    getMyStorage: jest.fn().mockResolvedValue({
      generatedAt: new Date(),
      userId: USER_ID,
      items: [],
    }),
  };
  const resolver = new DebugResolver(debugService as unknown as DebugService);
  return { resolver, debugService };
};

describe('DebugResolver — authentication', () => {
  const guardsOn = (method: string): unknown[] => [
    ...((Reflect.getMetadata(GUARDS_METADATA, DebugResolver) as unknown[]) ??
      []),
    ...((Reflect.getMetadata(
      GUARDS_METADATA,
      (DebugResolver.prototype as unknown as Record<string, object>)[method],
    ) as unknown[]) ?? []),
  ];

  it('debugMyStorage is behind GqlAuthGuard', () => {
    // `debugMyStorage` returns raw storage keys. Unguarded it would be an
    // anonymous enumeration surface, and the service's `NODE_ENV` check does
    // nothing about that outside production.
    expect(guardsOn('debugMyStorage')).toContain(GqlAuthGuard);
  });

  it('the guard is declared at class level, so every future query inherits it', () => {
    // Pinned deliberately: moving `@UseGuards` from the class onto the one
    // method today changes nothing, and then the *next* query added to this
    // resolver silently ships without a guard.
    expect(
      (Reflect.getMetadata(GUARDS_METADATA, DebugResolver) as unknown[]) ?? [],
    ).toContain(GqlAuthGuard);
  });
});

describe('DebugResolver.debugMyStorage', () => {
  it('scopes the diff to the authenticated caller', async () => {
    const { resolver, debugService } = makeResolver();

    await resolver.debugMyStorage({ id: USER_ID });

    // There is no argument on this query, so the caller's own id is the only
    // possible subject. Asserted anyway because the service trusts whatever
    // it is handed as the `where` for both reads.
    expect(debugService.getMyStorage).toHaveBeenCalledTimes(1);
    expect(debugService.getMyStorage).toHaveBeenCalledWith(USER_ID);
    expect(debugService.getMyStorage).not.toHaveBeenCalledWith(OTHER_ID);
  });

  it('declares no @Args, so a caller cannot name a subject', () => {
    // Asserted from the `@Args` metadata rather than from `Function.length`.
    // Arity is the wrong instrument: swapping `@CurrentUser()` for
    // `@Args('userId')` keeps the parameter count at 1, so an arity check
    // passes while the subject becomes caller-supplied. (That particular swap
    // is caught by `scopes the diff to the authenticated caller` above — this
    // test is about *adding* a client-controlled argument.)
    //
    // The declared-args set being empty is what makes a caregiver guard
    // unnecessary here. If this query ever grows one, this test fails and the
    // authorization question has to be answered before it ships.
    const raw = (Reflect.getMetadata(
      PARAM_ARGS_METADATA,
      DebugResolver,
      'debugMyStorage',
    ) ?? {}) as Record<string, { data?: string }>;

    // Calibration: the method does have one param decorator — `@CurrentUser()`,
    // which Nest records under a hashed `__customRouteArgs__` key. Asserting
    // it is present proves the metadata was actually read, so the empty
    // `@Args` result below cannot be a false negative from a wrong key.
    const keys = Object.keys(raw);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain('__customRouteArgs__');

    const argNames = keys
      .filter((key) => key.startsWith(`${GqlParamtype.ARGS}:`))
      .map((key) => raw[key].data);
    expect(argNames).toEqual([]);
  });

  it('returns the service result unchanged', async () => {
    const { resolver, debugService } = makeResolver();
    const payload = { generatedAt: new Date(), userId: USER_ID, items: [] };
    debugService.getMyStorage.mockResolvedValue(payload);

    await expect(resolver.debugMyStorage({ id: USER_ID })).resolves.toBe(
      payload,
    );
  });

  it('propagates the production refusal instead of returning an empty diff', async () => {
    const { resolver, debugService } = makeResolver();
    const error = new Error('Debug queries are disabled in production');
    debugService.getMyStorage.mockRejectedValue(error);

    // Catching this and returning `{ items: [] }` would make a disabled
    // endpoint indistinguishable from a user who has no media.
    await expect(resolver.debugMyStorage({ id: USER_ID })).rejects.toBe(error);
  });
});
