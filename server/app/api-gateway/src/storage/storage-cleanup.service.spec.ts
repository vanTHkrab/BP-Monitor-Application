/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageClient } from './s3-storage.client';
import { StorageCleanupService } from './storage-cleanup.service';

describe('StorageCleanupService', () => {
  let service: StorageCleanupService;
  let prisma: {
    image: { findMany: jest.Mock; deleteMany: jest.Mock };
  };
  let s3: { deleteMany: jest.Mock };

  beforeEach(async () => {
    prisma = {
      image: {
        findMany: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    s3 = { deleteMany: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        StorageCleanupService,
        { provide: PrismaService, useValue: prisma },
        { provide: S3StorageClient, useValue: s3 },
      ],
    }).compile();

    service = moduleRef.get(StorageCleanupService);
  });

  it('no-ops when there are no orphan images', async () => {
    prisma.image.findMany.mockResolvedValueOnce([]);

    await service.sweepOrphanImages();

    expect(s3.deleteMany).not.toHaveBeenCalled();
    expect(prisma.image.deleteMany).not.toHaveBeenCalled();
  });

  it('queries only orphans older than the grace window', async () => {
    prisma.image.findMany.mockResolvedValueOnce([]);
    const before = Date.now();

    await service.sweepOrphanImages();

    expect(prisma.image.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.image.findMany.mock.calls[0][0];
    expect(arg.where.readingId).toBeNull();
    // The cutoff must be ~24h in the past, never in the future, never
    // beyond the grace window — otherwise an in-flight upload could be
    // swept mid-flow.
    const cutoff = arg.where.uploadedAt.lt as Date;
    const ageMs = before - cutoff.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);
    expect(ageMs).toBeLessThanOrEqual(24 * 3600 * 1000 + 5000);
  });

  it('deletes S3 first, then DB rows — and uses the same id set', async () => {
    const orphans = [
      { id: 1, s3Key: 'users/u/bp/readings/2026-04/a.jpg' },
      { id: 2, s3Key: 'users/u/bp/readings/2026-04/b.jpg' },
      { id: 3, s3Key: 'users/u/bp/readings/2026-04/c.jpg' },
    ];
    prisma.image.findMany.mockResolvedValueOnce(orphans);
    prisma.image.deleteMany.mockResolvedValueOnce({ count: 3 });

    await service.sweepOrphanImages();

    expect(s3.deleteMany).toHaveBeenCalledTimes(1);
    expect(s3.deleteMany).toHaveBeenCalledWith(orphans.map((o) => o.s3Key));
    expect(prisma.image.deleteMany).toHaveBeenCalledTimes(1);
    const dbArg = prisma.image.deleteMany.mock.calls[0][0];
    expect(dbArg.where.id.in).toEqual([1, 2, 3]);

    // Order matters: failing S3 must leave DB rows intact for the next
    // tick to retry. Assert the call order by mock invocation timestamps.
    const s3CallOrder = s3.deleteMany.mock.invocationCallOrder[0];
    const dbCallOrder = prisma.image.deleteMany.mock.invocationCallOrder[0];
    expect(s3CallOrder).toBeLessThan(dbCallOrder);
  });

  it('preserves DB rows when S3 delete fails', async () => {
    prisma.image.findMany.mockResolvedValueOnce([
      { id: 1, s3Key: 'users/u/bp/readings/2026-04/a.jpg' },
    ]);
    s3.deleteMany.mockRejectedValueOnce(new Error('S3 unavailable'));

    await service.sweepOrphanImages();

    expect(prisma.image.deleteMany).not.toHaveBeenCalled();
  });

  it('caps work per run to MAX_DELETE_PER_RUN (500)', async () => {
    prisma.image.findMany.mockResolvedValueOnce([]);

    await service.sweepOrphanImages();

    const arg = prisma.image.findMany.mock.calls[0][0];
    expect(arg.take).toBe(500);
  });
});
