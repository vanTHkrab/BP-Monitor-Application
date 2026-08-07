/// <reference types="jest" />
/**
 * `AlertService` — the persistence layer for BP alerts.
 *
 * Every method here takes a `userId` that the resolver has already resolved
 * and authorized. That makes the `where` clause the load-bearing part: it is
 * the only thing scoping a query or an update to one person's alerts, and
 * dropping a key from it is a silent cross-tenant read or write that no
 * delegation-shaped test would notice. The `where` objects are therefore
 * asserted with `toEqual` on the whole argument rather than field by field.
 *
 * `PrismaService` is stubbed to an empty class so the generated Prisma client
 * never loads; the instance under test is constructed by hand with mocks.
 */
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AlertService } from './alert.service';

const RECIPIENT_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';

const CREATED_AT = new Date('2026-07-01T09:00:00.000Z');
const MEASURED_AT = new Date('2026-07-01T08:00:00.000Z');

const readingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  userId: PATIENT_ID,
  systolic: 181,
  diastolic: 121,
  pulse: 95,
  status: 'crisis',
  measuredAt: MEASURED_AT,
  images: [{ s3Key: 'users/patient/bp/first.jpg' }],
  ...overrides,
});

const alertRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: RECIPIENT_ID,
  bpReadingId: 7,
  alertMessage: 'ความดันสูงมาก',
  alertLevel: 'critical',
  readAt: null,
  createdAt: CREATED_AT,
  reading: readingRow(),
  ...overrides,
});

/**
 * Typed view of a Prisma mock's first call argument. `mock.calls` is `any`,
 * and asserting through it directly trips `no-unsafe-member-access`.
 */
type PrismaArgs = Record<string, unknown>;
const firstArg = (mock: jest.Mock): PrismaArgs =>
  (mock.mock.calls as PrismaArgs[][])[0][0];

const makeService = () => {
  const prisma = {
    alert: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const storage = {
    // Mirrors the real `StorageService.signImageKey`, which returns null for a
    // null/empty input rather than a URL. A mock that signs unconditionally
    // would hide the case where the service hands it nothing.
    signImageKey: jest.fn((raw: string | null) =>
      Promise.resolve(raw ? 'https://signed.example/first' : null),
    ),
  };
  const service = new AlertService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
  );
  return { service, prisma, storage };
};

describe('AlertService.list — query scoping', () => {
  it('scopes the query to the given user and does not filter on readAt by default', async () => {
    const { service, prisma } = makeService();

    await service.list(RECIPIENT_ID, 100, 0, false);

    // Asserted as the whole `where`, not just `userId`: an extra key here is
    // as much a behaviour change as a missing one, and `unreadOnly: false`
    // must not smuggle `readAt: null` in.
    expect(firstArg(prisma.alert.findMany).where).toEqual({
      userId: RECIPIENT_ID,
    });
  });

  it('adds the unread filter only when unreadOnly is set', async () => {
    const { service, prisma } = makeService();

    await service.list(RECIPIENT_ID, 100, 0, true);

    expect(firstArg(prisma.alert.findMany).where).toEqual({
      userId: RECIPIENT_ID,
      readAt: null,
    });
  });

  it('passes limit and offset through as take and skip, newest first', async () => {
    const { service, prisma } = makeService();

    await service.list(RECIPIENT_ID, 25, 50, false);

    const args = firstArg(prisma.alert.findMany);
    expect(args.take).toBe(25);
    expect(args.skip).toBe(50);
    // A silent flip to 'asc' would page the client through the oldest alerts
    // first — the reverse of what an alert feed means.
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('selects only the reading columns the GraphQL type exposes', async () => {
    const { service, prisma } = makeService();

    await service.list(RECIPIENT_ID, 100, 0, false);

    // Whole-object assertion on the include: the nested reading belongs to
    // the *patient*, so widening this select is how a caregiver's alert feed
    // starts carrying patient columns nobody asked for.
    expect(firstArg(prisma.alert.findMany).include).toEqual({
      reading: {
        select: {
          id: true,
          userId: true,
          systolic: true,
          diastolic: true,
          pulse: true,
          status: true,
          measuredAt: true,
          images: { select: { s3Key: true } },
        },
      },
    });
  });
});

describe('AlertService.list — row mapping', () => {
  it('maps a row with a reading to the full GraphQL shape', async () => {
    const { service, prisma, storage } = makeService();
    prisma.alert.findMany.mockResolvedValue([alertRow()]);

    const [alert] = await service.list(RECIPIENT_ID, 100, 0, false);

    expect(alert).toEqual({
      id: 1,
      userId: RECIPIENT_ID,
      bpReadingId: 7,
      alertMessage: 'ความดันสูงมาก',
      alertLevel: 'critical',
      readAt: undefined,
      createdAt: CREATED_AT,
      reading: {
        id: 7,
        userId: PATIENT_ID,
        systolic: 181,
        diastolic: 121,
        pulse: 95,
        status: 'crisis',
        measuredAt: MEASURED_AT,
        s3Key: 'https://signed.example/first',
      },
    });
    expect(storage.signImageKey).toHaveBeenCalledWith(
      'users/patient/bp/first.jpg',
    );
  });

  it('keeps the reading owner distinct from the alert recipient', async () => {
    const { service, prisma } = makeService();
    prisma.alert.findMany.mockResolvedValue([alertRow()]);

    const [alert] = await service.list(RECIPIENT_ID, 100, 0, false);

    // These two ids are the fan-out case: a caregiver receives an alert about
    // somebody else's reading. Collapsing `reading.userId` onto the alert's
    // own `userId` would make the client label the row as the caregiver's own
    // measurement.
    expect(alert.userId).toBe(RECIPIENT_ID);
    expect(alert.reading?.userId).toBe(PATIENT_ID);
  });

  it('turns a null readAt into undefined so the nullable field is absent', async () => {
    const { service, prisma } = makeService();
    prisma.alert.findMany.mockResolvedValue([alertRow({ readAt: null })]);

    const [alert] = await service.list(RECIPIENT_ID, 100, 0, false);

    expect(alert.readAt).toBeUndefined();
  });

  it('preserves a real readAt timestamp', async () => {
    const { service, prisma } = makeService();
    const readAt = new Date('2026-07-02T10:00:00.000Z');
    prisma.alert.findMany.mockResolvedValue([alertRow({ readAt })]);

    const [alert] = await service.list(RECIPIENT_ID, 100, 0, false);

    expect(alert.readAt).toBe(readAt);
  });

  it('omits the reading entirely when the alert has none', async () => {
    const { service, prisma, storage } = makeService();
    prisma.alert.findMany.mockResolvedValue([alertRow({ reading: undefined })]);

    const [alert] = await service.list(RECIPIENT_ID, 100, 0, false);

    expect(alert.reading).toBeUndefined();
    expect(storage.signImageKey).toHaveBeenCalledWith(null);
  });

  it('signs only the first image when a reading has several', async () => {
    const { service, prisma, storage } = makeService();
    prisma.alert.findMany.mockResolvedValue([
      alertRow({
        reading: readingRow({
          images: [
            { s3Key: 'users/patient/bp/first.jpg' },
            { s3Key: 'users/patient/bp/second.jpg' },
          ],
        }),
      }),
    ]);

    await service.list(RECIPIENT_ID, 100, 0, false);

    expect(storage.signImageKey).toHaveBeenCalledTimes(1);
    expect(storage.signImageKey).toHaveBeenCalledWith(
      'users/patient/bp/first.jpg',
    );
  });

  it('passes null to the signer when the reading has no images', async () => {
    const { service, prisma, storage } = makeService();
    prisma.alert.findMany.mockResolvedValue([
      alertRow({ reading: readingRow({ images: [] }) }),
    ]);

    const [alert] = await service.list(RECIPIENT_ID, 100, 0, false);

    expect(storage.signImageKey).toHaveBeenCalledWith(null);
    expect(alert.reading?.s3Key).toBeUndefined();
  });

  it('leaves s3Key absent when signing yields null', async () => {
    const { service, prisma, storage } = makeService();
    prisma.alert.findMany.mockResolvedValue([alertRow()]);
    storage.signImageKey.mockResolvedValue(null);

    const [alert] = await service.list(RECIPIENT_ID, 100, 0, false);

    expect(alert.reading?.s3Key).toBeUndefined();
  });

  it('maps every row, preserving order', async () => {
    const { service, prisma } = makeService();
    prisma.alert.findMany.mockResolvedValue([
      alertRow({ id: 3 }),
      alertRow({ id: 2 }),
      alertRow({ id: 1 }),
    ]);

    const alerts = await service.list(RECIPIENT_ID, 100, 0, false);

    expect(alerts.map((a) => a.id)).toEqual([3, 2, 1]);
  });
});

describe('AlertService.markRead', () => {
  it('scopes the update to the caller and to unread rows only', async () => {
    const { service, prisma } = makeService();

    await service.markRead(RECIPIENT_ID, 42);

    // Whole-argument assertion. Dropping `userId` from this `where` lets any
    // authenticated caller mark another user's alert as read purely by
    // guessing an integer id — the resolver does no ownership check of its
    // own, so this clause *is* the authorization.
    expect(prisma.alert.updateMany).toHaveBeenCalledWith({
      where: { id: 42, userId: RECIPIENT_ID, readAt: null },
      data: { readAt: expect.any(Date) as Date },
    });
  });

  it('reports true when a row was updated', async () => {
    const { service, prisma } = makeService();
    prisma.alert.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.markRead(RECIPIENT_ID, 42)).resolves.toBe(true);
  });

  it('reports false when nothing matched — wrong owner, missing id, or already read', async () => {
    const { service, prisma } = makeService();
    prisma.alert.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.markRead(RECIPIENT_ID, 42)).resolves.toBe(false);
  });
});

describe('AlertService.markAllRead', () => {
  it('updates only the caller unread alerts', async () => {
    const { service, prisma } = makeService();

    await service.markAllRead(RECIPIENT_ID);

    expect(prisma.alert.updateMany).toHaveBeenCalledWith({
      where: { userId: RECIPIENT_ID, readAt: null },
      data: { readAt: expect.any(Date) as Date },
    });
  });

  it('reports true even when the caller had nothing unread', async () => {
    const { service, prisma } = makeService();
    prisma.alert.updateMany.mockResolvedValue({ count: 0 });

    // Deliberate: "mark all read" is idempotent, so an empty inbox is a
    // success, not a failure. Documented here because the contrast with
    // `markRead`'s count-sensitive return looks like an oversight otherwise.
    await expect(service.markAllRead(RECIPIENT_ID)).resolves.toBe(true);
  });
});
