import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageClient } from './s3-storage.client';

// How long an Image row may sit with `readingId IS NULL` before the
// sweeper treats it as orphan. The upload→createReading window in the
// happy path is seconds; 24 h is the largest plausible interactive
// gap (user paused mid-flow, app backgrounded, retry queue), and is
// short enough that S3 storage doesn't accumulate noticeable noise.
const ORPHAN_GRACE_HOURS = 24;

// One S3 batch delete request caps at 1000 keys, and listing N rows
// from the DB then deleting them is a single transaction-safe write.
// We cap per-run to avoid one slow run hogging the DB / S3 budget;
// the next tick picks up whatever's left over.
const MAX_DELETE_PER_RUN = 500;

/**
 * Sweeps Image rows that were uploaded but never attached to a
 * BloodPressureReading. With the Image-as-base-model design, every
 * confirmed S3 PUT creates an Image row with `readingId = null`; the
 * row is only marked attached when ``createReading`` / ``submitBPReading``
 * runs. A user closing the app between confirmUpload and createReading
 * leaves both an Image row and the underlying S3 object orphaned —
 * this cron is the only thing that reclaims them.
 *
 * The sweep is intentionally idempotent and slow:
 *
 *  - It only deletes rows older than ``ORPHAN_GRACE_HOURS`` so it
 *    can't race in-flight uploads.
 *  - It batches S3 deletes via ``deleteMany`` (one HTTP call per 1000
 *    keys, S3's cap) then issues a single SQL ``deleteMany`` keyed by
 *    the same id list — if either step fails the other will retry on
 *    the next tick.
 *  - Per-run cap caps blast radius (a runaway accumulation can't
 *    deadlock the DB or thrash S3 in one sweep).
 *
 * Triggered by ``@Cron`` from ``@nestjs/schedule``; ``ScheduleModule.forRoot()``
 * lives in [app.module.ts](../app.module.ts).
 */
@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3StorageClient,
  ) {}

  // Daily at 03:00 in the server's local timezone. Off-peak for the
  // mobile app's expected user base (Thailand) and well clear of any
  // BP-reading-heavy time window. Hardcoding the cron expression here
  // is fine — there's no per-environment configuration we need to
  // override yet; promote to env when that changes.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweepOrphanImages(): Promise<void> {
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_HOURS * 3600 * 1000);

    const orphans = await this.prisma.image.findMany({
      where: {
        readingId: null,
        uploadedAt: { lt: cutoff },
      },
      select: { id: true, s3Key: true },
      take: MAX_DELETE_PER_RUN,
    });

    if (orphans.length === 0) {
      this.logger.debug('No orphan images to sweep');
      return;
    }

    this.logger.log(
      `Sweeping ${orphans.length} orphan image(s) older than ${ORPHAN_GRACE_HOURS}h`,
    );

    // S3 first, DB second. If S3 fails we keep the row so the next
    // tick retries the S3 delete; the alternative (DB first) would
    // strand bytes in S3 with no DB pointer to find them.
    try {
      await this.s3.deleteMany(orphans.map((o) => o.s3Key));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`S3 delete failed; leaving DB rows intact: ${msg}`);
      return;
    }

    const { count } = await this.prisma.image.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    });
    this.logger.log(`Deleted ${count} orphan image row(s)`);
  }
}
