/// <reference types="jest" />
/**
 * `DebugService` — the cross-tier media diff behind `debugMyStorage`.
 *
 * This is a developer surface that ships in the production schema:
 * `DebugModule` is imported unconditionally by `AppModule`, so the query
 * exists on every deployment and the *only* thing keeping it off the prod
 * surface is a runtime `NODE_ENV === 'production'` check inside this service.
 * That check is therefore the highest-value assertion in this file, and it is
 * asserted three ways: that it throws, that it throws *before* touching
 * Postgres or S3, and that it is re-read per call rather than captured once.
 *
 * The rest of the file covers the two things this service does that could
 * leak or crash: the `where`/`select` scoping of the two Prisma reads, and
 * `extractKey`, which decides whether an arbitrary stored string becomes an
 * S3 HEAD call.
 *
 * `PrismaService` is stubbed so the generated client never loads.
 */
import { ForbiddenException } from '@nestjs/common';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { S3StorageClient } from '../storage/s3-storage.client';
import { DebugService } from './debug.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const UPLOADED_AT = new Date('2026-07-01T08:00:00.000Z');

const imageRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  s3Key: 'users/u1/bp/7.jpg',
  readingId: 42,
  uploadedAt: UPLOADED_AT,
  ...overrides,
});

const makeService = (opts: { avatar?: string | null; user?: null } = {}) => {
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.user === null ? null : { avatar: opts.avatar ?? null },
        ),
    },
    image: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const s3 = {
    head: jest.fn().mockResolvedValue({ contentLength: 1234 }),
  };
  const service = new DebugService(
    prisma as unknown as PrismaService,
    s3 as unknown as S3StorageClient,
  );
  // Silence the intentional warn on the HEAD-failure path.
  jest
    .spyOn(
      (service as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    )
    .mockImplementation(() => undefined);
  return { service, prisma, s3 };
};

describe('DebugService.getMyStorage — the production kill switch', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    // `delete` rather than assignment when the original was unset: assigning
    // `undefined` to a process.env key stores the *string* "undefined", which
    // would leak a bogus NODE_ENV into every later suite. Jest always sets
    // NODE_ENV=test so this branch is unreachable today — it is here to match
    // `app.module.spec.ts` and to stay correct if that ever changes.
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('refuses in production', async () => {
    const { service } = makeService();
    process.env.NODE_ENV = 'production';

    // ForbiddenException specifically, not merely "throws": `errorFormatter`
    // maps 403 to `extensions.code = 'FORBIDDEN'`, which the mobile client
    // dispatches on. A NotFoundException here would be a 404 and a different
    // client-visible code.
    await expect(service.getMyStorage(USER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getMyStorage(USER_ID)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('refuses in production before reading Postgres or probing S3', async () => {
    const { service, prisma, s3 } = makeService({ avatar: 'users/u1/a.jpg' });
    prisma.image.findMany.mockResolvedValue([imageRow()]);
    process.env.NODE_ENV = 'production';

    await expect(service.getMyStorage(USER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // The side-effect assertion. A gate placed after the queries still throws
    // and would leave the assertion above green, while having already run the
    // O(N) HEAD amplification and pulled raw storage keys out of the DB. Only
    // these three lines distinguish the two.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.image.findMany).not.toHaveBeenCalled();
    expect(s3.head).not.toHaveBeenCalled();
  });

  it('re-reads NODE_ENV on every call rather than capturing it once', async () => {
    // Regression guard against the `GRAPHIQL_ENABLED` shape: an env-gated
    // branch hoisted to module load or to the constructor evaluates against
    // whatever the environment was when the process started. Same instance,
    // both answers.
    const { service } = makeService();

    process.env.NODE_ENV = 'development';
    await expect(service.getMyStorage(USER_ID)).resolves.toBeDefined();

    process.env.NODE_ENV = 'production';
    await expect(service.getMyStorage(USER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    process.env.NODE_ENV = 'development';
    await expect(service.getMyStorage(USER_ID)).resolves.toBeDefined();
  });

  it.each(['development', 'test', 'staging'])(
    'serves the diff when NODE_ENV is %s',
    async (env) => {
      const { service } = makeService();
      process.env.NODE_ENV = env;

      await expect(service.getMyStorage(USER_ID)).resolves.toMatchObject({
        userId: USER_ID,
      });
    },
  );

  it('serves the diff when NODE_ENV is unset', async () => {
    const { service } = makeService();
    delete process.env.NODE_ENV;

    await expect(service.getMyStorage(USER_ID)).resolves.toMatchObject({
      userId: USER_ID,
    });
  });
});

describe('DebugService.getMyStorage — query scoping', () => {
  it('reads only the avatar column for the caller', async () => {
    const { service, prisma } = makeService();

    await service.getMyStorage(USER_ID);

    // Whole-argument assertion. This is a debug payload that renders raw
    // values in a client table; widening the select would put whatever new
    // column was added — `email` and `phone` are both `@unique` sign-in
    // identities — into it without anyone noticing.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { avatar: true },
    });
  });

  it('reads only the caller images, newest first, capped at 200', async () => {
    const { service, prisma } = makeService();

    await service.getMyStorage(USER_ID);

    // Losing `userId` here turns a self-service debug query into a dump of
    // every user's raw storage keys; losing `take` turns one request into an
    // unbounded number of S3 HEAD calls.
    expect(prisma.image.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        s3Key: true,
        readingId: true,
        uploadedAt: true,
      },
      take: 200,
    });
  });

  it('echoes the requested userId and stamps a generation time', async () => {
    const { service } = makeService();

    const result = await service.getMyStorage(USER_ID);

    expect(result.userId).toBe(USER_ID);
    expect(result.generatedAt).toBeInstanceOf(Date);
  });
});

describe('DebugService.getMyStorage — item assembly', () => {
  it('emits the avatar probe first, then one item per image in query order', async () => {
    const { service, prisma } = makeService({ avatar: 'users/u1/a.jpg' });
    prisma.image.findMany.mockResolvedValue([
      imageRow({ id: 9 }),
      imageRow({ id: 8 }),
    ]);

    const result = await service.getMyStorage(USER_ID);

    expect(result.items.map((i) => i.refId)).toEqual([
      'avatar',
      'image:9',
      'image:8',
    ]);
  });

  it('always emits an avatar row, even when the user has no avatar', async () => {
    const { service, s3 } = makeService({ avatar: null });

    const result = await service.getMyStorage(USER_ID);

    expect(result.items).toEqual([
      {
        source: 'avatar',
        refId: 'avatar',
        rawKey: undefined,
        s3Exists: false,
        s3ContentLength: undefined,
        note: 'user.avatar is null',
      },
    ]);
    // Nothing to probe means nothing is sent to S3.
    expect(s3.head).not.toHaveBeenCalled();
  });

  it('treats a missing user row like a missing avatar rather than throwing', async () => {
    const { service } = makeService({ user: null });

    const result = await service.getMyStorage(USER_ID);

    expect(result.items[0].note).toBe('user.avatar is null');
  });

  it('describes an image attached to a reading', async () => {
    const { service, prisma } = makeService();
    prisma.image.findMany.mockResolvedValue([imageRow({ readingId: 42 })]);

    const result = await service.getMyStorage(USER_ID);

    expect(result.items[1]).toEqual({
      source: 'image',
      refId: 'image:7',
      rawKey: 'users/u1/bp/7.jpg',
      s3Exists: true,
      s3ContentLength: 1234,
      note: 'attached to reading:42 · uploaded_at: 2026-07-01T08:00:00.000Z',
    });
  });

  it('flags an image with no reading as an orphan', async () => {
    const { service, prisma } = makeService();
    prisma.image.findMany.mockResolvedValue([imageRow({ readingId: null })]);

    // The orphan/attached split is the actionable part of the diff: an orphan
    // is either an in-flight upload or a row the cleanup cron will sweep.
    expect((await service.getMyStorage(USER_ID)).items[1].note).toBe(
      'orphan (no reading attached) · uploaded_at: 2026-07-01T08:00:00.000Z',
    );
  });
});

describe('DebugService.getMyStorage — HEAD results', () => {
  it('reports a missing object as absent with no size', async () => {
    const { service, s3 } = makeService({ avatar: 'users/u1/a.jpg' });
    s3.head.mockResolvedValue(null);

    const [avatar] = (await service.getMyStorage(USER_ID)).items;

    expect(avatar.s3Exists).toBe(false);
    expect(avatar.s3ContentLength).toBeUndefined();
  });

  it('reports a zero-byte object as present with a size of 0', async () => {
    // A zero-length object exists. Coercing the size with `||` instead of
    // `??` would report it as unknown, which reads as "not checked" in the
    // client table — the opposite of the finding, since a 0-byte upload is
    // exactly the corruption this diff is for.
    const { service, s3 } = makeService({ avatar: 'users/u1/a.jpg' });
    s3.head.mockResolvedValue({ contentLength: 0 });

    const [avatar] = (await service.getMyStorage(USER_ID)).items;

    expect(avatar.s3Exists).toBe(true);
    expect(avatar.s3ContentLength).toBe(0);
  });

  it('records a HEAD failure on the item instead of failing the request', async () => {
    const { service, s3 } = makeService({ avatar: 'users/u1/a.jpg' });
    const error = new Error('boom');
    error.name = 'AccessDenied';
    s3.head.mockRejectedValue(error);

    const [avatar] = (await service.getMyStorage(USER_ID)).items;

    expect(avatar.s3Exists).toBe(false);
    expect(avatar.rawKey).toBe('users/u1/a.jpg');
    expect(avatar.note).toBe('HEAD error: AccessDenied');
  });

  it('appends the HEAD failure to an existing note rather than replacing it', async () => {
    const { service, prisma, s3 } = makeService({ avatar: null });
    prisma.image.findMany.mockResolvedValue([imageRow({ readingId: null })]);
    const error = new Error('boom');
    error.name = 'TimeoutError';
    s3.head.mockRejectedValue(error);

    const result = await service.getMyStorage(USER_ID);

    expect(result.items[1].note).toBe(
      'orphan (no reading attached) · uploaded_at: 2026-07-01T08:00:00.000Z · HEAD error: TimeoutError',
    );
  });

  it('keeps probing the remaining items after one HEAD throws', async () => {
    const { service, prisma, s3 } = makeService({ avatar: 'users/u1/a.jpg' });
    prisma.image.findMany.mockResolvedValue([
      imageRow({ id: 9, s3Key: 'users/u1/bp/9.jpg' }),
      imageRow({ id: 8, s3Key: 'users/u1/bp/8.jpg' }),
    ]);
    s3.head
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'Oops' }))
      .mockResolvedValue({ contentLength: 10 });

    const result = await service.getMyStorage(USER_ID);

    // The swallow is deliberate — a broken probe must not cost the whole
    // diff — so this asserts the *primary* work still completed.
    expect(result.items).toHaveLength(3);
    expect(result.items[0].note).toBe('HEAD error: Oops');
    expect(result.items[1].s3Exists).toBe(true);
    expect(result.items[2].s3Exists).toBe(true);
  });

  it('labels a non-Error rejection rather than crashing on error.name', async () => {
    const { service, s3 } = makeService({ avatar: 'users/u1/a.jpg' });
    s3.head.mockRejectedValue('a bare string');

    const [avatar] = (await service.getMyStorage(USER_ID)).items;

    expect(avatar.note).toBe('HEAD error: UnknownError');
  });
});

describe('DebugService — which stored values become an S3 HEAD', () => {
  const probeAvatar = async (avatar: string) => {
    const { service, s3 } = makeService({ avatar });
    const [item] = (await service.getMyStorage(USER_ID)).items;
    return { item, s3 };
  };

  it.each([
    ['users/u1/profile/avatar/a.jpg', 'users/u1/profile/avatar/a.jpg'],
    ['tmp/u1/pending.jpg', 'tmp/u1/pending.jpg'],
    ['  users/u1/padded.jpg  ', 'users/u1/padded.jpg'],
  ])('probes %s as key %s', async (raw, expected) => {
    const { item, s3 } = await probeAvatar(raw);

    expect(s3.head).toHaveBeenCalledWith(expected);
    expect(item.rawKey).toBe(expected);
  });

  it('pulls the key out of a legacy public URL', async () => {
    const { item, s3 } = await probeAvatar(
      'https://cdn.example.com/bucket/users/u1/a.jpg?X-Amz-Signature=abc',
    );

    expect(s3.head).toHaveBeenCalledWith('users/u1/a.jpg');
    expect(item.rawKey).toBe('users/u1/a.jpg');
  });

  it('accepts a URL whose traversal the URL parser already resolved away', async () => {
    // `/%2E%2E/users/...` normalizes to `/users/...` inside `new URL`, so no
    // `..` ever reaches the decoded path. Pinned so the refusal case below is
    // understood as covering the traversals that actually survive parsing,
    // not as a blanket ban on the sequence appearing in the input.
    const { item, s3 } = await probeAvatar(
      'https://cdn.example.com/%2E%2E/users/u1/a.jpg',
    );

    expect(s3.head).toHaveBeenCalledWith('users/u1/a.jpg');
    expect(item.s3Exists).toBe(true);
  });

  it.each([
    ['users/u1/../../etc/passwd', 'a literal traversal segment'],
    [
      'https://cdn.example.com/users/u1/%2E%2E%2Fetc/passwd',
      // `%2F` survives WHATWG URL path normalization, so this traversal only
      // becomes visible after `decodeURIComponent` — which is exactly why the
      // `..` check is repeated on the decoded path and not just on the raw
      // input. Dropping the second check leaves the first one green.
      'a percent-encoded traversal that only appears after decoding',
    ],
    ['not-a-key-and-not-a-url', 'an unrecognised value'],
    ['   ', 'whitespace'],
    ['ftp://example.com/somewhere/else.jpg', 'a URL with no allowed prefix'],
  ])('refuses to HEAD %s (%s)', async (raw) => {
    const { item, s3 } = await probeAvatar(raw);

    // Two assertions and both matter: the item still reports the raw value so
    // the diff is honest about what is in the DB, and no request is made — a
    // traversal that reached `s3.head` would be an SSRF-shaped probe of the
    // bucket driven by whatever string sits in `user.avatar`.
    expect(s3.head).not.toHaveBeenCalled();
    expect(item.note).toBe('rawKey is not a recognized storage key');
    expect(item.rawKey).toBe(raw);
    expect(item.s3Exists).toBe(false);
  });
});
