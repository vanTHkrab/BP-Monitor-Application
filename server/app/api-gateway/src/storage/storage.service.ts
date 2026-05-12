import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { S3StorageClient } from './s3-storage.client';
import { ALLOWED_IMAGE_PREFIXES } from './types/storage.types';

interface ImageObject {
  body: Readable;
  contentType: string;
  contentLength?: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly s3: S3StorageClient) {}

  /**
   * Stream an S3 object back to an HTTP client. Used by the
   * `/storage/image?key=…` REST endpoint so mobile/web can render images
   * without exposing a public S3 bucket.
   */
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
}
