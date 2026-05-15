import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageClient } from '../storage/s3-storage.client';
import { DebugMyStorageType, DebugStorageItemType } from './debug.types';

const MAX_PROBES_PER_REQUEST = 200;

@Injectable()
export class DebugService {
  private readonly logger = new Logger(DebugService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3StorageClient,
  ) {}

  /**
   * Cross-tier media diff for the caller — pulls every media reference
   * owned by `userId` from the DB and HEADs each one against S3 so the
   * client can render a single table of "what does each tier think exists".
   *
   * Hard-disabled in production: even gated by `GqlAuthGuard`, this
   * endpoint amplifies one request into O(N) S3 HEAD calls + leaks raw
   * storage keys, neither of which we want on the prod surface.
   */
  async getMyStorage(userId: string): Promise<DebugMyStorageType> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Debug queries are disabled in production');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    const images = await this.prisma.image.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      select: { id: true, s3Key: true, syncStatus: true, uploadedAt: true },
      take: MAX_PROBES_PER_REQUEST,
    });

    const readings = await this.prisma.bloodPressureReading.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      select: { id: true, s3Key: true },
      take: MAX_PROBES_PER_REQUEST,
    });

    const items: DebugStorageItemType[] = [];

    items.push(
      await this.probe({
        source: 'avatar',
        refId: 'avatar',
        rawKey: user?.avatar ?? null,
        note: user?.avatar ? undefined : 'user.avatar is null',
      }),
    );

    for (const img of images) {
      items.push(
        await this.probe({
          source: 'image',
          refId: `image:${img.id}`,
          rawKey: img.s3Key,
          note: `sync_status: ${img.syncStatus} · uploaded_at: ${img.uploadedAt.toISOString()}`,
        }),
      );
    }

    for (const r of readings) {
      items.push(
        await this.probe({
          source: 'reading',
          refId: `reading:${r.id}`,
          rawKey: r.s3Key,
          note: r.s3Key ? undefined : 'reading has no s3Key (manual entry)',
        }),
      );
    }

    return {
      generatedAt: new Date(),
      userId,
      items,
    };
  }

  private async probe(input: {
    source: string;
    refId: string;
    rawKey: string | null;
    note?: string;
  }): Promise<DebugStorageItemType> {
    if (!input.rawKey) {
      return {
        source: input.source,
        refId: input.refId,
        rawKey: undefined,
        s3Exists: false,
        s3ContentLength: undefined,
        note: input.note,
      };
    }

    const key = this.extractKey(input.rawKey);
    if (!key) {
      return {
        source: input.source,
        refId: input.refId,
        rawKey: input.rawKey,
        s3Exists: false,
        s3ContentLength: undefined,
        note: 'rawKey is not a recognized storage key',
      };
    }

    try {
      const head = await this.s3.head(key);
      return {
        source: input.source,
        refId: input.refId,
        rawKey: key,
        s3Exists: head != null,
        s3ContentLength: head?.contentLength ?? undefined,
        note: input.note,
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`HEAD failed source=${input.source} key=${key} error=${name}`);
      return {
        source: input.source,
        refId: input.refId,
        rawKey: key,
        s3Exists: false,
        s3ContentLength: undefined,
        note: `${input.note ? input.note + ' · ' : ''}HEAD error: ${name}`,
      };
    }
  }

  /**
   * Pull a `users/...` or `tmp/...` key out of either a raw key or a
   * legacy publicUrl. Returns null for anything we don't recognize so
   * the probe records the value but skips the HEAD call.
   */
  private extractKey(rawValue: string): string | null {
    const raw = rawValue.trim();
    if (!raw || raw.includes('..')) return null;

    if (raw.startsWith('users/') || raw.startsWith('tmp/')) return raw;

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (path.includes('..')) return null;
    for (const prefix of ['users/', 'tmp/']) {
      const idx = path.indexOf(prefix);
      if (idx >= 0) return path.slice(idx);
    }
    return null;
  }
}
