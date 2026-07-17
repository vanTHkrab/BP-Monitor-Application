/// <reference types="jest" />

import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';

// Keep the DTO import from dragging the guard's heavy transitive deps (jwt,
// redis, prisma) into this pure validation test — same shim the reading spec
// uses.
jest.mock('../auth/auth.guard', () => ({
  GqlAuthGuard: class GqlAuthGuard {},
}));
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { CreatePostInput, UpdatePostInput } from './post.resolver';

// Mirror the global pipe configured in main.ts so this test reproduces the
// exact whitelist behavior that was 400ing every community write.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const meta = (metatype: new () => unknown): ArgumentMetadata => ({
  type: 'body',
  metatype,
  data: 'input',
});

describe('CreatePostInput validation', () => {
  it('accepts a contract-valid payload (regression: previously 400d with "property X should not exist")', async () => {
    await expect(
      pipe.transform(
        {
          content: 'สวัสดีชุมชน ขอสอบถามเรื่องความดัน',
          category: 'general',
          clientId: 'local-post-abc',
        },
        meta(CreatePostInput),
      ),
    ).resolves.toMatchObject({
      content: 'สวัสดีชุมชน ขอสอบถามเรื่องความดัน',
      category: 'general',
    });
  });

  it.each(['general', 'experience', 'qa'])(
    'accepts real PostCategory value %s',
    async (category) => {
      await expect(
        pipe.transform({ content: 'hi', category }, meta(CreatePostInput)),
      ).resolves.toMatchObject({ category });
    },
  );

  it('rejects empty content', async () => {
    await expect(
      pipe.transform(
        { content: '', category: 'general' },
        meta(CreatePostInput),
      ),
    ).rejects.toThrow();
  });

  it('rejects an out-of-enum category', async () => {
    await expect(
      pipe.transform(
        { content: 'hi', category: 'bogus' },
        meta(CreatePostInput),
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown property (forbidNonWhitelisted still active)', async () => {
    await expect(
      pipe.transform(
        { content: 'hi', category: 'general', injected: 1 },
        meta(CreatePostInput),
      ),
    ).rejects.toThrow();
  });
});

describe('UpdatePostInput validation', () => {
  it('accepts a partial update and coerces a numeric-string id', async () => {
    await expect(
      pipe.transform(
        { id: '7', content: 'edited body' },
        meta(UpdatePostInput),
      ),
    ).resolves.toMatchObject({ id: 7, content: 'edited body' });
  });

  it('rejects a non-integer id', async () => {
    await expect(
      pipe.transform({ id: 'abc' }, meta(UpdatePostInput)),
    ).rejects.toThrow();
  });
});
