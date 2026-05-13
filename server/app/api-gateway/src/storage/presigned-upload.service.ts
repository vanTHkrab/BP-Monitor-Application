import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmImageUploadInput } from './dto/confirm-image-upload.input';
import { ConfirmedImageObject } from './dto/confirmed-image.object';
import { PresignedUploadObject } from './dto/presigned-upload.object';
import { RequestImageUploadInput } from './dto/request-image-upload.input';
import { S3StorageClient } from './s3-storage.client';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ImageKind,
  MAX_IMAGE_BYTES,
  buildFinalKey,
  buildTmpKey,
  isTmpKeyOwnedBy,
} from './types/storage.types';

const PRESIGN_TTL_SECONDS = 300; // 5 minutes — long enough for slow networks, short enough to limit replay window

@Injectable()
export class PresignedUploadService {
  private readonly logger = new Logger(PresignedUploadService.name);

  constructor(
    private readonly s3: S3StorageClient,
    private readonly prisma: PrismaService,
  ) {}

  async request(
    userId: string,
    input: RequestImageUploadInput,
  ): Promise<PresignedUploadObject> {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(input.mimeType)) {
      throw new BadRequestException('ประเภทไฟล์รูปภาพไม่รองรับ');
    }
    if (input.size <= 0 || input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        `ไฟล์รูปต้องไม่เกิน ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB`,
      );
    }

    // Tmp keys are feature-agnostic — a single lifecycle rule on `tmp/`
    // cleans orphans regardless of what feature requested the upload.
    const key = buildTmpKey(userId, randomUUID(), input.mimeType);
    const { url, expiresAt } = await this.s3.presignPut({
      key,
      contentType: input.mimeType,
      contentLength: input.size,
      expiresIn: PRESIGN_TTL_SECONDS,
    });

    this.logger.log(
      `Issued presigned PUT userId=${userId} kind=${input.kind} key=${key} size=${input.size}B ttl=${PRESIGN_TTL_SECONDS}s`,
    );

    return {
      uploadUrl: url,
      key,
      expiresAt,
      headers: [
        { name: 'Content-Type', value: input.mimeType },
        { name: 'Content-Length', value: String(input.size) },
      ],
    };
  }

  async confirm(
    userId: string,
    input: ConfirmImageUploadInput,
  ): Promise<ConfirmedImageObject> {
    if (!isTmpKeyOwnedBy(userId, input.key)) {
      throw new ForbiddenException('ไม่อนุญาตให้ยืนยันไฟล์นี้');
    }

    const head = await this.s3.head(input.key);
    if (!head) {
      throw new NotFoundException('ยังไม่พบไฟล์ที่อัปโหลด');
    }
    if (head.contentLength > MAX_IMAGE_BYTES) {
      // Defense-in-depth: presigned PUT already constrains Content-Length,
      // but verify on the server we control before persisting anything.
      await this.s3.delete(input.key).catch(() => undefined);
      throw new BadRequestException('ไฟล์รูปภาพมีขนาดใหญ่เกินกำหนด');
    }
    if (!head.contentType.startsWith('image/')) {
      await this.s3.delete(input.key).catch(() => undefined);
      throw new BadRequestException('ประเภทไฟล์รูปภาพไม่ถูกต้อง');
    }

    const finalKey = this.promote(
      input.key,
      input.kind,
      userId,
      head.contentType,
    );
    await this.s3.move({ sourceKey: input.key, destinationKey: finalKey });

    const imageId =
      input.kind === ImageKind.BLOOD_PRESSURE_READING
        ? await this.createImageRecord(userId, finalKey)
        : undefined;

    this.logger.log(
      `Confirmed upload userId=${userId} kind=${input.kind} key=${finalKey} imageId=${imageId ?? '-'}`,
    );

    return {
      key: finalKey,
      url: this.s3.publicUrl(finalKey),
      imageId,
    };
  }

  /**
   * Move an object out of the feature-agnostic tmp/ namespace into the
   * permanent kind-specific location. Reuses the object id (uuid) and
   * extension from the tmp key so the destination is stable.
   */
  private promote(
    tmpKey: string,
    kind: ImageKind,
    userId: string,
    contentType: string,
  ): string {
    const filename = tmpKey.split('/').pop() ?? '';
    const objectId = filename.replace(extname(filename), '') || randomUUID();
    return buildFinalKey(kind, userId, objectId, contentType);
  }

  private async createImageRecord(
    userId: string,
    key: string,
  ): Promise<number> {
    const image = await this.prisma.image.create({
      data: {
        userId,
        s3Key: key,
        deviceName: 'blood-pressure-monitor',
        syncStatus: 'synced',
        syncedAt: new Date(),
        uploadedAt: new Date(),
      },
      select: { id: true },
    });
    return image.id;
  }
}
