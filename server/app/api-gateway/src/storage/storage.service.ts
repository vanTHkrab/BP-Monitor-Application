import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import type { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { SyncStorageImagesObject } from './dto/sync-storage-images.object';
import { UploadedImageObject } from './dto/uploaded-image.object';
import { S3StorageClient } from './s3-storage.client';
import {
  ALLOWED_IMAGE_PREFIXES,
  IMAGE_FOLDERS,
  MAX_IMAGE_BYTES,
  MIME_TYPE_EXTENSIONS,
  type ImageKind,
} from './types/storage.types';

interface UploadImageArgs {
  userId: string;
  kind: ImageKind;
  base64: string;
  mimeType: string;
  fileName?: string;
}

interface ImageObject {
  body: Readable;
  contentType: string;
  contentLength?: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly s3: S3StorageClient,
    private readonly prisma: PrismaService,
  ) {}

  async uploadImage(args: UploadImageArgs): Promise<UploadedImageObject> {
    const body = this.decodeImage(args.base64, args.mimeType);
    const key = this.buildImageKey(
      args.userId,
      args.kind,
      args.fileName,
      args.mimeType,
    );

    this.logger.log(
      `Uploading kind=${args.kind} userId=${args.userId} key=${key} size=${body.length}B`,
    );

    try {
      await this.s3.put({
        key,
        body,
        contentType: args.mimeType,
        metadata: { userId: args.userId, kind: args.kind },
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      const message =
        error instanceof Error ? error.message : 'Unknown S3 upload error';
      this.logger.error(`Upload failed key=${key} error=${name}: ${message}`);
      throw new InternalServerErrorException(
        `อัปโหลดรูปไปยัง S3 ไม่สำเร็จ (${name})`,
      );
    }

    const imageId =
      args.kind === 'blood-pressure-reading'
        ? await this.createImageRecord({
            userId: args.userId,
            imageUrl: key,
            deviceName: 'blood-pressure-monitor',
          })
        : undefined;

    return {
      key,
      bucket: this.s3.bucket,
      url: key,
      imageId,
    };
  }

  async syncBloodPressureImagesFromPrefix(
    userId: string,
    prefix?: string,
  ): Promise<SyncStorageImagesObject> {
    const safePrefix = this.resolveBloodPressurePrefix(userId, prefix);
    let scanned = 0;
    let inserted = 0;
    let skipped = 0;

    for await (const item of this.s3.listAll(safePrefix)) {
      scanned += 1;

      const exists = await this.prisma.image.findFirst({
        where: {
          userId,
          OR: [
            { imageUrl: item.key },
            { imageUrl: this.s3.publicUrl(item.key) },
            { imageUrl: this.s3.storageUri(item.key) },
          ],
        },
        select: { id: true },
      });

      if (exists) {
        skipped += 1;
        continue;
      }

      await this.createImageRecord({
        userId,
        imageUrl: item.key,
        deviceName: 'blood-pressure-monitor',
        uploadedAt: item.lastModified,
      });
      inserted += 1;
    }

    this.logger.log(
      `Synced userId=${userId} prefix=${safePrefix} scanned=${scanned} inserted=${inserted} skipped=${skipped}`,
    );

    return { prefix: safePrefix, scanned, inserted, skipped };
  }

  async getImageObject(key: string): Promise<ImageObject> {
    this.assertAllowedKey(key);

    try {
      const result = await this.s3.get(key);
      return {
        body: result.body,
        contentType: result.contentType,
        contentLength: result.contentLength,
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`Read image failed key=${key} error=${name}`);
      throw new NotFoundException('ไม่พบรูปภาพ');
    }
  }

  private decodeImage(base64: string, mimeType: string): Buffer {
    if (!mimeType.startsWith('image/')) {
      throw new BadRequestException('รองรับเฉพาะไฟล์รูปภาพเท่านั้น');
    }

    const cleanBase64 = base64.includes(',')
      ? (base64.split(',').pop() ?? '')
      : base64;
    const body = Buffer.from(cleanBase64, 'base64');

    if (body.length === 0) {
      throw new BadRequestException('ไฟล์รูปภาพไม่ถูกต้อง');
    }
    if (body.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('รูปภาพมีขนาดใหญ่เกิน 8MB');
    }
    return body;
  }

  private buildImageKey(
    userId: string,
    kind: ImageKind,
    fileName: string | undefined,
    mimeType: string,
  ): string {
    const folder = IMAGE_FOLDERS[kind];
    const ext =
      extname(this.sanitizeFileName(fileName)) ||
      MIME_TYPE_EXTENSIONS[mimeType] ||
      '';
    const datePart = new Date().toISOString().slice(0, 10);
    return `${folder}/${userId}/${datePart}/${randomUUID()}${ext}`;
  }

  private sanitizeFileName(name?: string): string {
    if (!name) return '';
    return basename(name)
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(0, 80);
  }

  private assertAllowedKey(key: string): void {
    const normalizedKey = key.replace(/^\/+/, '');
    if (
      !normalizedKey ||
      normalizedKey.includes('..') ||
      !ALLOWED_IMAGE_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))
    ) {
      throw new ForbiddenException('ไม่อนุญาตให้เข้าถึงไฟล์นี้');
    }
  }

  private resolveBloodPressurePrefix(userId: string, prefix?: string): string {
    const defaultPrefix = `training/blood-pressure-meter-images/${userId}`;
    const normalized = (prefix?.trim() || defaultPrefix).replace(/^\/+/, '');

    const allowedPrefixes = [
      `training/blood-pressure-meter-images/${userId}`,
      `blood-pressure-meter-images/${userId}`,
    ];

    if (!allowedPrefixes.some((allowed) => normalized.startsWith(allowed))) {
      throw new ForbiddenException(
        'อนุญาตให้ซิงก์เฉพาะรูปเครื่องวัดความดันของผู้ใช้ปัจจุบันเท่านั้น',
      );
    }

    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }

  private async createImageRecord(args: {
    userId: string;
    imageUrl: string;
    deviceName: string;
    uploadedAt?: Date;
  }): Promise<number> {
    const image = await this.prisma.image.create({
      data: {
        userId: args.userId,
        imageUrl: args.imageUrl,
        deviceName: args.deviceName,
        syncStatus: 'synced',
        syncedAt: new Date(),
        uploadedAt: args.uploadedAt ?? new Date(),
      },
      select: { id: true },
    });
    return image.id;
  }
}
