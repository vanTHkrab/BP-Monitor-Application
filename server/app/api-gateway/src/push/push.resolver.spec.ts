/// <reference types="jest" />
/**
 * `PushResolver` — the GraphQL surface of the push module.
 *
 * The resolver is two one-line delegations, so almost nothing here is worth a
 * behavioural test. What is worth testing is the part that has no behaviour to
 * observe at all:
 *
 *  1. **Both mutations carry `GqlAuthGuard`.** Deleting a `@UseGuards` line
 *     changes nothing any other test sees. `PushService.unregisterToken`
 *     scopes its delete to `{ token, userId }` precisely so one user cannot
 *     silence another's device — but that scoping is worth nothing if the
 *     `userId` it trusts came from an unauthenticated caller.
 *  2. **Neither mutation takes the subject as an argument.** The whole
 *     authorization story of this module is "the user id comes from the
 *     session, never from the wire". A `userId` argument appearing here would
 *     let any caller reassign or delete any device's token, and it would
 *     type-check, pass the service tests, and match the schema.
 *
 * This file exists because the review that found the missing `channelId` also
 * found that this module — the one carrying the alert the whole feature is
 * for — had no resolver spec at all.
 *
 * `PrismaService` is stubbed so the generated client never loads, and nothing
 * imported here pulls in `expo-server-sdk`: `push.service.ts` reaches it only
 * through `import type` plus the `EXPO_PUSH_CLIENT` token, which is why the
 * concrete client lives in `expo-push.provider.ts`. Importing that file from a
 * spec stops the whole suite parsing — see `expo-push.client.ts`.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
// Deep imports, deliberately — the same note as `alert/alert.resolver.spec.ts`.
// `@Args` records its metadata under `PARAM_ARGS_METADATA` on the resolver
// *constructor*, keyed `"<GqlParamtype>:<paramIndex>"`, and neither constant
// is re-exported from the package root. Both are pinned to @nestjs/graphql 13.
import { PARAM_ARGS_METADATA } from '@nestjs/graphql/dist/graphql.constants';
import { GqlParamtype } from '@nestjs/graphql/dist/enums/gql-paramtype.enum';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { GqlAuthGuard } from '../auth/auth.guard';
import { PushResolver } from './push.resolver';
import { PushService } from './push.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';

const makeResolver = () => {
  const pushService = {
    registerToken: jest.fn().mockResolvedValue(true),
    unregisterToken: jest.fn().mockResolvedValue(true),
  };
  const resolver = new PushResolver(pushService as unknown as PushService);
  return { resolver, pushService };
};

describe('PushResolver — which operations require a session', () => {
  // Nest merges class-level and method-level guards, so reading only the
  // prototype method would miss a class-level `@UseGuards` and vice versa.
  // Both are read here; the union is what actually runs.
  const guardsOn = (method: string): unknown[] => [
    ...((Reflect.getMetadata(GUARDS_METADATA, PushResolver) as unknown[]) ??
      []),
    ...((Reflect.getMetadata(
      GUARDS_METADATA,
      (PushResolver.prototype as unknown as Record<string, object>)[method],
    ) as unknown[]) ?? []),
  ];

  it.each(['registerPushToken', 'unregisterPushToken'])(
    '%s is behind GqlAuthGuard',
    (method) => {
      expect(guardsOn(method)).toContain(GqlAuthGuard);
    },
  );

  it('has no public operation on this resolver', () => {
    // The inverse direction. Nothing on this module is reachable without a
    // session — there is no read API here at all — so a newly added unguarded
    // operation is a defect by construction rather than a judgement call.
    const methods = Object.getOwnPropertyNames(PushResolver.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods.sort()).toEqual([
      'registerPushToken',
      'unregisterPushToken',
    ]);
    for (const method of methods) {
      expect(guardsOn(method)).toContain(GqlAuthGuard);
    }
  });
});

describe('PushResolver — which arguments the client controls', () => {
  const argNamesOn = (method: string): (string | undefined)[] => {
    const raw = (Reflect.getMetadata(PARAM_ARGS_METADATA, PushResolver, method) ??
      {}) as Record<string, { data?: string }>;
    return Object.keys(raw)
      .filter((key) => key.startsWith(`${GqlParamtype.ARGS}:`))
      .map((key) => raw[key].data)
      .sort();
  };

  // Doubles as calibration: a non-empty expectation on one method means an
  // absent `userId` on the others cannot be a false negative from a wrong
  // metadata key or a Nest version bump.
  it('registerPushToken takes only the input object', () => {
    expect(argNamesOn('registerPushToken')).toEqual(['input']);
  });

  it('unregisterPushToken takes only the token', () => {
    // `token` names a device, not a person. The delete is scoped to the
    // caller's own rows in the service; a `userId` argument here would undo
    // that at the door.
    expect(argNamesOn('unregisterPushToken')).toEqual(['token']);
  });
});

describe('PushResolver — the subject comes from the session', () => {
  it('registers against the caller id, not anything in the input', async () => {
    const { resolver, pushService } = makeResolver();

    // The extra key is what a hand-rolled client, or a future widening of
    // `RegisterPushTokenInput`, could smuggle in. It must not reach the
    // service as the subject.
    const input = {
      token: TOKEN,
      deviceLabel: 'Pixel 8',
      platform: 'android',
      userId: OTHER_USER_ID,
    } as never;

    await resolver.registerPushToken({ id: USER_ID }, input);

    expect(pushService.registerToken).toHaveBeenCalledWith(USER_ID, input);
  });

  it('unregisters against the caller id', async () => {
    const { resolver, pushService } = makeResolver();

    await resolver.unregisterPushToken({ id: USER_ID }, TOKEN);

    expect(pushService.unregisterToken).toHaveBeenCalledWith(USER_ID, TOKEN);
  });

  it('passes the service result through unchanged', async () => {
    // `unregisterToken` returns false when the token was not the caller's.
    // The resolver must not dress that up as success: the client uses it to
    // decide whether the device still has a live registration.
    const { resolver, pushService } = makeResolver();
    pushService.unregisterToken.mockResolvedValue(false);

    await expect(
      resolver.unregisterPushToken({ id: USER_ID }, TOKEN),
    ).resolves.toBe(false);
  });
});
