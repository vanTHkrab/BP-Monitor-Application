/// <reference types="jest" />
/**
 * `AlertResolver` — the GraphQL surface of the alert module.
 *
 * The resolver is thin, so what earns a test is the part a delegation check
 * would not notice:
 *
 *  1. **Which subject the query runs against.** `alerts(patientId:)` takes a
 *     caller-supplied id. Whether `assertCanViewPatient` runs, and whether it
 *     runs *before* the read, is the whole authorization story for a
 *     caregiver reading a patient's alert feed.
 *  2. **Which operations carry `GqlAuthGuard`.** All three must. A deleted
 *     `@UseGuards` line changes nothing any behavioural test observes, and
 *     `markAllAlertsRead` unguarded is an unauthenticated write.
 *
 * Imports stop at `GqlAuthGuard` and `CaregiverService`. `auth.guard.ts`
 * reaches `better-auth` only through `import type` plus the token file, so
 * the ESM-only package never enters the CJS transform; `PrismaService` is
 * stubbed anyway so the generated client does not load either.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenException } from '@nestjs/common';
// Deep imports, deliberately — see the matching note in
// `debug/debug.resolver.spec.ts`. `@Args` records its metadata under
// `PARAM_ARGS_METADATA` on the resolver *constructor*, keyed
// `"<GqlParamtype>:<paramIndex>"`, and neither is re-exported from the
// package root. Both are pinned to @nestjs/graphql 13.
import { PARAM_ARGS_METADATA } from '@nestjs/graphql/dist/graphql.constants';
import { GqlParamtype } from '@nestjs/graphql/dist/enums/gql-paramtype.enum';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { GqlAuthGuard } from '../auth/auth.guard';
import { CaregiverService } from '../caregiver/caregiver.service';
import { AlertResolver } from './alert.resolver';
import { AlertService } from './alert.service';

const CAREGIVER_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';

const makeResolver = () => {
  const alertService = {
    list: jest.fn().mockResolvedValue([]),
    markRead: jest.fn().mockResolvedValue(true),
    markAllRead: jest.fn().mockResolvedValue(true),
  };
  const caregiverService = {
    assertCanViewPatient: jest.fn().mockResolvedValue(undefined),
    assertCanRecordForPatient: jest.fn().mockResolvedValue(undefined),
    assertCanEditPatientHealth: jest.fn().mockResolvedValue(undefined),
  };
  const resolver = new AlertResolver(
    alertService as unknown as AlertService,
    caregiverService as unknown as CaregiverService,
  );
  return { resolver, alertService, caregiverService };
};

describe('AlertResolver — which operations require a session', () => {
  // Nest merges class-level and method-level guards, so reading only the
  // prototype method would miss a class-level `@UseGuards` and vice versa.
  // Both are read here; the union is what actually runs.
  const guardsOn = (method: string): unknown[] => [
    ...((Reflect.getMetadata(GUARDS_METADATA, AlertResolver) as unknown[]) ??
      []),
    ...((Reflect.getMetadata(
      GUARDS_METADATA,
      (AlertResolver.prototype as unknown as Record<string, object>)[method],
    ) as unknown[]) ?? []),
  ];

  it.each(['alerts', 'markAlertRead', 'markAllAlertsRead'])(
    '%s is behind GqlAuthGuard',
    (method) => {
      // Asserted from decorator metadata, not by calling the resolver: a
      // deleted `@UseGuards` line leaves every delegation test below green
      // while exposing an alert feed — and two writes — to any caller.
      expect(guardsOn(method)).toContain(GqlAuthGuard);
    },
  );

  it('has no public operation on this resolver', () => {
    // The inverse direction. Unlike `security/`, nothing here can be reached
    // without a session, so a newly added unguarded query is a defect by
    // construction rather than a judgement call.
    const methods = Object.getOwnPropertyNames(AlertResolver.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods.sort()).toEqual([
      'alerts',
      'markAlertRead',
      'markAllAlertsRead',
    ]);
    for (const method of methods) {
      expect(guardsOn(method)).toContain(GqlAuthGuard);
    }
  });
});

describe('AlertResolver — which arguments the client controls', () => {
  const argNamesOn = (method: string): (string | undefined)[] => {
    const raw = (Reflect.getMetadata(
      PARAM_ARGS_METADATA,
      AlertResolver,
      method,
    ) ?? {}) as Record<string, { data?: string }>;
    return Object.keys(raw)
      .filter((key) => key.startsWith(`${GqlParamtype.ARGS}:`))
      .map((key) => raw[key].data)
      .sort();
  };

  // Doubles as calibration for `argNamesOn`: a non-empty expectation here
  // means an empty result on the two mutations below cannot be a false
  // negative from a wrong metadata key or a Nest version bump.
  it('alerts is the only operation taking a caller-supplied subject', () => {
    expect(argNamesOn('alerts')).toEqual([
      'limit',
      'offset',
      'patientId',
      'unreadOnly',
    ]);
  });

  it('markAlertRead takes only the alert id', () => {
    // `id` names a row, not a person, and the row is scoped by `userId` in
    // the service. A second argument appearing here is the thing to catch.
    expect(argNamesOn('markAlertRead')).toEqual(['id']);
  });

  it('markAllAlertsRead takes no arguments at all', () => {
    expect(argNamesOn('markAllAlertsRead')).toEqual([]);
  });
});

describe('AlertResolver.alerts — subject resolution and authorization', () => {
  it('defaults to the caller own alerts and runs no link check', async () => {
    const { resolver, alertService, caregiverService } = makeResolver();

    await resolver.alerts({ id: CAREGIVER_ID }, 100, 0, false);

    expect(caregiverService.assertCanViewPatient).not.toHaveBeenCalled();
    expect(alertService.list).toHaveBeenCalledWith(CAREGIVER_ID, 100, 0, false);
  });

  it('treats an explicit patientId equal to the caller id as a self-read', async () => {
    const { resolver, alertService, caregiverService } = makeResolver();

    await resolver.alerts({ id: CAREGIVER_ID }, 100, 0, false, CAREGIVER_ID);

    expect(caregiverService.assertCanViewPatient).not.toHaveBeenCalled();
    expect(alertService.list).toHaveBeenCalledWith(CAREGIVER_ID, 100, 0, false);
  });

  it('authorizes a caregiver against the requested patient, then reads that patient feed', async () => {
    const { resolver, alertService, caregiverService } = makeResolver();

    await resolver.alerts({ id: CAREGIVER_ID }, 50, 10, true, PATIENT_ID);

    expect(caregiverService.assertCanViewPatient).toHaveBeenCalledWith(
      CAREGIVER_ID,
      PATIENT_ID,
    );
    // The subject switches to the patient. Falling back to `user.id` here
    // renders the caregiver's own unread count beside the patient's
    // readings — two people's data on one screen.
    expect(alertService.list).toHaveBeenCalledWith(PATIENT_ID, 50, 10, true);
  });

  it('refuses an unlinked caregiver before any alert is read', async () => {
    const { resolver, alertService, caregiverService } = makeResolver();
    caregiverService.assertCanViewPatient.mockRejectedValue(
      new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลของผู้ป่วยรายนี้'),
    );

    await expect(
      resolver.alerts({ id: CAREGIVER_ID }, 100, 0, false, PATIENT_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The side-effect assertion is the point: a check that runs *after* the
    // read still throws, but the rows have already been fetched. Only this
    // line distinguishes "refused" from "refused too late".
    expect(alertService.list).not.toHaveBeenCalled();
  });

  it('propagates ForbiddenException so the client sees extensions.code FORBIDDEN', async () => {
    const { resolver, caregiverService } = makeResolver();
    caregiverService.assertCanViewPatient.mockRejectedValue(
      new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลของผู้ป่วยรายนี้'),
    );

    // `errorFormatter` maps 403 to FORBIDDEN, which the mobile client
    // dispatches on. Swallowing the rejection into an empty list, or
    // rewrapping it as a 500, is a client-visible contract break.
    await expect(
      resolver.alerts({ id: CAREGIVER_ID }, 100, 0, false, PATIENT_ID),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('uses the view-level check, not a write-level one', async () => {
    const { resolver, caregiverService } = makeResolver();

    await resolver.alerts({ id: CAREGIVER_ID }, 100, 0, false, PATIENT_ID);

    // Reading an alert feed must not demand `full` permission: a `view`-only
    // caregiver is entitled to it, and upgrading the check here would silently
    // break their screen.
    expect(caregiverService.assertCanRecordForPatient).not.toHaveBeenCalled();
    expect(caregiverService.assertCanEditPatientHealth).not.toHaveBeenCalled();
  });

  it('returns whatever the service produced', async () => {
    const { resolver, alertService } = makeResolver();
    const rows = [{ id: 1 }];
    alertService.list.mockResolvedValue(rows);

    await expect(
      resolver.alerts({ id: CAREGIVER_ID }, 100, 0, false),
    ).resolves.toBe(rows);
  });
});

describe('AlertResolver — the two write operations are always self-scoped', () => {
  it('markAlertRead acts as the caller, never as a supplied subject', async () => {
    const { resolver, alertService, caregiverService } = makeResolver();

    await expect(
      resolver.markAlertRead({ id: CAREGIVER_ID }, 42),
    ).resolves.toBe(true);

    // No `patientId` argument exists on this mutation, so there is nothing
    // to authorize here — the ownership check lives in the service's `where`
    // clause. Why the asymmetry with `alerts(patientId:)` is unexplained: a
    // `full` caregiver can read a patient's alerts but cannot mark them read,
    // and nothing in the module records whether that was decided or merely
    // never came up. Pinned so that a change to it is a deliberate one, not
    // so that it stays — adding a subject argument here without a caregiver
    // guard would be a cross-tenant write, and answering the question is the
    // point of the failure.
    expect(alertService.markRead).toHaveBeenCalledWith(CAREGIVER_ID, 42);
    expect(caregiverService.assertCanViewPatient).not.toHaveBeenCalled();
  });

  it('markAllAlertsRead acts as the caller', async () => {
    const { resolver, alertService, caregiverService } = makeResolver();

    await expect(
      resolver.markAllAlertsRead({ id: CAREGIVER_ID }),
    ).resolves.toBe(true);

    expect(alertService.markAllRead).toHaveBeenCalledWith(CAREGIVER_ID);
    expect(caregiverService.assertCanViewPatient).not.toHaveBeenCalled();
  });

  it('markAlertRead reports the service false verdict rather than swallowing it', async () => {
    const { resolver, alertService } = makeResolver();
    alertService.markRead.mockResolvedValue(false);

    // `false` means "no row matched" — a wrong owner, a missing id, or an
    // already-read alert. Hardcoding `true` would make the client believe a
    // mark succeeded when the row belonged to somebody else.
    await expect(
      resolver.markAlertRead({ id: CAREGIVER_ID }, 42),
    ).resolves.toBe(false);
  });
});
