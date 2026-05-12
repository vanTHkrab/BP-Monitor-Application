// Jest's mock.calls typings collapse to `any`, which trips no-unsafe-member-access
// on otherwise correct test code. Disabling at file scope for this spec only.
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PresignedUploadService } from './presigned-upload.service';
import { S3StorageClient } from './s3-storage.client';
import { ImageKind, MAX_IMAGE_BYTES } from './types/storage.types';

type S3Mock = {
  bucket: string;
  presignPut: jest.Mock;
  head: jest.Mock;
  delete: jest.Mock;
  move: jest.Mock;
  publicUrl: jest.Mock;
};

type PrismaMock = {
  image: { create: jest.Mock };
};

const buildS3Mock = (): S3Mock => ({
  bucket: 'test-bucket',
  presignPut: jest.fn(),
  head: jest.fn(),
  delete: jest.fn().mockResolvedValue(undefined),
  move: jest.fn().mockResolvedValue(undefined),
  publicUrl: jest.fn((key: string) => `https://cdn.example/${key}`),
});

const buildPrismaMock = (): PrismaMock => ({
  image: { create: jest.fn() },
});

describe('PresignedUploadService', () => {
  let service: PresignedUploadService;
  let s3: S3Mock;
  let prisma: PrismaMock;

  beforeEach(async () => {
    s3 = buildS3Mock();
    prisma = buildPrismaMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PresignedUploadService,
        { provide: S3StorageClient, useValue: s3 },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(PresignedUploadService);
  });

  describe('request', () => {
    const validInput = {
      kind: ImageKind.PROFILE,
      mimeType: 'image/jpeg',
      size: 1024,
    };

    it('issues presigned URL with tmp key under the user namespace', async () => {
      const expiresAt = new Date('2030-01-01');
      s3.presignPut.mockResolvedValueOnce({
        url: 'https://s3.example/put',
        expiresAt,
      });

      const result = await service.request('user-1', validInput);

      expect(s3.presignPut).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'image/jpeg',
          contentLength: 1024,
          expiresIn: 300,
        }),
      );
      const presignCall = s3.presignPut.mock.calls[0][0] as { key: string };
      expect(presignCall.key).toMatch(/^tmp\/user-1\/[a-f0-9-]+\.jpg$/);
      expect(result.uploadUrl).toBe('https://s3.example/put');
      expect(result.expiresAt).toBe(expiresAt);
      expect(result.headers).toEqual([
        { name: 'Content-Type', value: 'image/jpeg' },
        { name: 'Content-Length', value: '1024' },
      ]);
    });

    it('uses the same tmp namespace for BLOOD_PRESSURE_READING (feature-agnostic)', async () => {
      s3.presignPut.mockResolvedValueOnce({
        url: 'https://s3.example/put',
        expiresAt: new Date(),
      });
      await service.request('user-1', {
        ...validInput,
        kind: ImageKind.BLOOD_PRESSURE_READING,
      });
      const presignCall = s3.presignPut.mock.calls[0][0] as { key: string };
      expect(presignCall.key).toMatch(/^tmp\/user-1\/[a-f0-9-]+\.jpg$/);
    });

    it('rejects unsupported mime types', async () => {
      await expect(
        service.request('user-1', {
          ...validInput,
          mimeType: 'application/pdf',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s3.presignPut).not.toHaveBeenCalled();
    });

    it('rejects size <= 0', async () => {
      await expect(
        service.request('user-1', { ...validInput, size: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects size > MAX_IMAGE_BYTES', async () => {
      await expect(
        service.request('user-1', { ...validInput, size: MAX_IMAGE_BYTES + 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('confirm', () => {
    const tmpKey = 'tmp/user-1/abc.jpg';

    it('promotes profile tmp object to users/<id>/profile/avatar/...', async () => {
      s3.head.mockResolvedValueOnce({
        contentType: 'image/jpeg',
        contentLength: 1024,
      });

      const result = await service.confirm('user-1', {
        kind: ImageKind.PROFILE,
        key: tmpKey,
      });

      expect(s3.move).toHaveBeenCalledTimes(1);
      const moveCall = s3.move.mock.calls[0][0] as {
        sourceKey: string;
        destinationKey: string;
      };
      expect(moveCall.sourceKey).toBe(tmpKey);
      expect(moveCall.destinationKey).toMatch(
        /^users\/user-1\/profile\/avatar\/abc\.jpg$/,
      );
      expect(result.url).toBe(`https://cdn.example/${moveCall.destinationKey}`);
      expect(result.imageId).toBeUndefined();
      expect(prisma.image.create).not.toHaveBeenCalled();
    });

    it('promotes BP tmp object to users/<id>/bp/readings/<YYYY-MM>/... and creates Image row', async () => {
      const bpTmpKey = 'tmp/user-1/xyz.png';
      s3.head.mockResolvedValueOnce({
        contentType: 'image/png',
        contentLength: 2048,
      });
      prisma.image.create.mockResolvedValueOnce({ id: 42 });

      const result = await service.confirm('user-1', {
        kind: ImageKind.BLOOD_PRESSURE_READING,
        key: bpTmpKey,
      });

      const moveCall = s3.move.mock.calls[0][0] as {
        sourceKey: string;
        destinationKey: string;
      };
      expect(moveCall.destinationKey).toMatch(
        /^users\/user-1\/bp\/readings\/\d{4}-\d{2}\/xyz\.png$/,
      );
      expect(prisma.image.create).toHaveBeenCalledTimes(1);
      expect(result.imageId).toBe(42);
    });

    it('rejects keys that do not belong to the user', async () => {
      await expect(
        service.confirm('user-1', {
          kind: ImageKind.PROFILE,
          key: 'tmp/other-user/abc.jpg',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(s3.head).not.toHaveBeenCalled();
    });

    it('rejects keys outside the tmp/ namespace', async () => {
      await expect(
        service.confirm('user-1', {
          kind: ImageKind.PROFILE,
          key: 'users/user-1/profile/avatar/abc.jpg',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects keys with path traversal', async () => {
      await expect(
        service.confirm('user-1', {
          kind: ImageKind.PROFILE,
          key: 'tmp/user-1/../../etc/passwd',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFound when S3 HEAD returns null', async () => {
      s3.head.mockResolvedValueOnce(null);
      await expect(
        service.confirm('user-1', { kind: ImageKind.PROFILE, key: tmpKey }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(s3.move).not.toHaveBeenCalled();
    });

    it('deletes oversized objects + throws BadRequest', async () => {
      s3.head.mockResolvedValueOnce({
        contentType: 'image/jpeg',
        contentLength: MAX_IMAGE_BYTES + 1,
      });
      await expect(
        service.confirm('user-1', { kind: ImageKind.PROFILE, key: tmpKey }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s3.delete).toHaveBeenCalledWith(tmpKey);
      expect(s3.move).not.toHaveBeenCalled();
      expect(prisma.image.create).not.toHaveBeenCalled();
    });

    it('deletes objects with non-image content type + throws BadRequest', async () => {
      s3.head.mockResolvedValueOnce({
        contentType: 'application/pdf',
        contentLength: 1024,
      });
      await expect(
        service.confirm('user-1', { kind: ImageKind.PROFILE, key: tmpKey }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s3.delete).toHaveBeenCalledWith(tmpKey);
    });
  });
});
