/// <reference types="jest" />

import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';

import { CreateCommentInput, UpdateCommentInput } from './comment.types';

// Mirror the global pipe from main.ts so this test reproduces the exact
// whitelist behavior that was 400ing every community comment write.
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

describe('CreateCommentInput validation', () => {
  it('accepts a contract-valid payload (regression: previously 400d with "property X should not exist")', async () => {
    await expect(
      pipe.transform(
        { postId: 12, content: 'เห็นด้วยครับ', parentId: 3 },
        meta(CreateCommentInput),
      ),
    ).resolves.toMatchObject({
      postId: 12,
      content: 'เห็นด้วยครับ',
      parentId: 3,
    });
  });

  it('accepts a top-level comment without parentId', async () => {
    await expect(
      pipe.transform(
        { postId: 12, content: 'top-level' },
        meta(CreateCommentInput),
      ),
    ).resolves.toMatchObject({ postId: 12, content: 'top-level' });
  });

  it('coerces numeric-string ids', async () => {
    await expect(
      pipe.transform(
        { postId: '12', content: 'hi', parentId: '3' },
        meta(CreateCommentInput),
      ),
    ).resolves.toMatchObject({ postId: 12, parentId: 3 });
  });

  it('rejects empty content', async () => {
    await expect(
      pipe.transform({ postId: 12, content: '' }, meta(CreateCommentInput)),
    ).rejects.toThrow();
  });

  it('rejects a missing/non-integer postId', async () => {
    await expect(
      pipe.transform(
        { postId: 'nope', content: 'hi' },
        meta(CreateCommentInput),
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown property (forbidNonWhitelisted still active)', async () => {
    await expect(
      pipe.transform(
        { postId: 12, content: 'hi', injected: true },
        meta(CreateCommentInput),
      ),
    ).rejects.toThrow();
  });
});

describe('UpdateCommentInput validation', () => {
  it('accepts a valid edit', async () => {
    await expect(
      pipe.transform(
        { id: 5, content: 'edited comment' },
        meta(UpdateCommentInput),
      ),
    ).resolves.toMatchObject({ id: 5, content: 'edited comment' });
  });

  it('rejects empty content', async () => {
    await expect(
      pipe.transform({ id: 5, content: '' }, meta(UpdateCommentInput)),
    ).rejects.toThrow();
  });
});
