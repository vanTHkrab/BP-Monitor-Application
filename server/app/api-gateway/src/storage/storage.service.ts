import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import { basename, extname, resolve } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type ImageKind = 'profile' | 'blood-pressure-reading';

interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl?: string;
}

const loadS3Env = () => {
  const candidates = [
    resolve(process.cwd(), 'web/.env'),
    resolve(process.cwd(), '../../../web/.env'),
    resolve(__dirname, '../../../../../../web/.env'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      dotenv.config({ path, override: false });
      return;
    }
  }
};

const getExtensionFromMimeType = (mimeType: string) => {
  switch (mimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/heic':
      return '.heic';
    default:
      return '';
  }
};

const sanitizeFileName = (name?: string) => {
  if (!name) return '';
  return basename(name).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
};

const getImageFolder = (kind: ImageKind) => {
  switch (kind) {
    case 'profile':
      return 'app/profile-images';
    case 'blood-pressure-reading':
      return 'training/blood-pressure-meter-images';
  }
};

const allowedImagePrefixes = [
  'app/profile-images/',
  'training/blood-pressure-meter-images/',
  'profiles/',
  'blood-pressure-meter-images/',
];

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly config: StorageConfig;

  constructor(private readonly prisma: PrismaService) {
    loadS3Env();

    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET_NAME;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Missing S3 config. Please set S3_ENDPOINT, S3_BUCKET_NAME, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.',
      );
    }

    this.config = {
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: process.env.S3_DEFAULT_REGION || 'auto',
      forcePathStyle: process.env.S3_USE_PATH_STYLE_ENDPOINT === 'true',
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
    };

    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });

    this.logger.log(
      `S3 storage ready provider=${process.env.S3_PROVIDER ?? 's3'} bucket=${this.config.bucket} region=${this.config.region} endpoint=${this.maskEndpoint(this.config.endpoint)} pathStyle=${this.config.forcePathStyle}`,
    );
  }

  async uploadImage({
    userId,
    kind,
    base64,
    mimeType,
    fileName,
  }: {
    userId: string;
    kind: ImageKind;
    base64: string;
    mimeType: string;
    fileName?: string;
  }) {
    if (!mimeType.startsWith('image/')) {
      throw new BadRequestException('รองรับเฉพาะไฟล์รูปภาพเท่านั้น');
    }

    const cleanBase64 = base64.includes(',')
      ? base64.split(',').pop() || ''
      : base64;
    const body = Buffer.from(cleanBase64, 'base64');

    if (body.length === 0) {
      throw new BadRequestException('ไฟล์รูปภาพไม่ถูกต้อง');
    }

    const maxSizeBytes = 8 * 1024 * 1024;
    if (body.length > maxSizeBytes) {
      throw new BadRequestException('รูปภาพมีขนาดใหญ่เกิน 8MB');
    }

    const folder = getImageFolder(kind);
    const ext =
      extname(sanitizeFileName(fileName)) || getExtensionFromMimeType(mimeType);
    const key = `${folder}/${userId}/${new Date()
      .toISOString()
      .slice(0, 10)}/${randomUUID()}${ext}`;

    this.logger.log(
      `Uploading image kind=${kind} userId=${userId} bucket=${this.config.bucket} key=${key} mimeType=${mimeType} size=${body.length}B`,
    );

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: mimeType,
          Metadata: {
            userId,
            kind,
          },
        }),
      );

      const url = this.getStorageReference(key);
      let imageId: number | undefined;
      if (kind === 'blood-pressure-reading') {
        imageId = await this.createImageRecord({
          userId,
          imageUrl: url,
          deviceName: 'blood-pressure-monitor',
        });
      }
      this.logger.log(
        `Uploaded image success kind=${kind} key=${key} imageId=${imageId ?? '-'} storageRef=${this.maskStorageReference(url)}`,
      );

      return {
        key,
        bucket: this.config.bucket,
        url,
        imageId,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown S3 upload error';
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `Uploaded image failed kind=${kind} bucket=${this.config.bucket} key=${key} error=${name}: ${message}`,
      );
      throw new InternalServerErrorException(
        `อัปโหลดรูปไปยัง S3 ไม่สำเร็จ (${name})`,
      );
    }
  }

  async syncBloodPressureImagesFromPrefix(userId: string, prefix?: string) {
    const safePrefix = this.resolveBloodPressurePrefix(userId, prefix);
    let continuationToken: string | undefined;
    let scanned = 0;
    let inserted = 0;
    let skipped = 0;

    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: safePrefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const item of result.Contents ?? []) {
        const key = item.Key;
        if (!key || key.endsWith('/')) continue;
        scanned += 1;

        const url = this.getStorageReference(key);
        const exists = await this.prisma.image.findFirst({
          where: {
            userId,
            OR: [
              { imageUrl: url },
              { imageUrl: this.getPublicUrl(key) },
              { imageUrl: `s3://${this.config.bucket}/${key}` },
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
          imageUrl: url,
          deviceName: 'blood-pressure-monitor',
          uploadedAt: item.LastModified,
        });
        inserted += 1;
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken);

    this.logger.log(
      `Synced storage images userId=${userId} prefix=${safePrefix} scanned=${scanned} inserted=${inserted} skipped=${skipped}`,
    );

    return {
      prefix: safePrefix,
      scanned,
      inserted,
      skipped,
    };
  }

  async getImageObject(key: string) {
    const normalizedKey = key.replace(/^\/+/, '');

    if (
      normalizedKey.includes('..') ||
      !allowedImagePrefixes.some((prefix) => normalizedKey.startsWith(prefix))
    ) {
      throw new ForbiddenException('ไม่อนุญาตให้เข้าถึงไฟล์นี้');
    }

    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: normalizedKey,
        }),
      );

      if (!result.Body) {
        throw new NotFoundException('ไม่พบรูปภาพ');
      }

      return {
        body: result.Body,
        contentType: result.ContentType || 'application/octet-stream',
        contentLength: result.ContentLength,
      };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `Read image failed key=${normalizedKey} error=${name}`,
      );
      throw new NotFoundException('ไม่พบรูปภาพ');
    }
  }

  private getPublicUrl(key: string) {
    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    }

    return `${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}/${key}`;
  }

  private getStorageReference(key: string) {
    return key;
  }

  private async createImageRecord({
    userId,
    imageUrl,
    deviceName,
    uploadedAt,
  }: {
    userId: string;
    imageUrl: string;
    deviceName: string;
    uploadedAt?: Date;
  }) {
    const image = await this.prisma.image.create({
      data: {
        userId,
        imageUrl,
        deviceName,
        syncStatus: 'synced',
        syncedAt: new Date(),
        uploadedAt: uploadedAt ?? new Date(),
      },
      select: { id: true },
    });

    return image.id;
  }

  private resolveBloodPressurePrefix(userId: string, prefix?: string) {
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

  private maskEndpoint(url: string) {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch {
      return '[invalid-endpoint]';
    }
  }

  private maskUrl(url: string) {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}/${parsed.pathname
        .split('/')
        .filter(Boolean)
        .slice(0, 3)
        .join('/')}/...`;
    } catch {
      return '[invalid-url]';
    }
  }

  private maskStorageReference(value: string) {
    const directPrefix = allowedImagePrefixes.find((prefix) =>
      value.startsWith(prefix),
    );
    if (directPrefix) {
      return `${value.split('/').slice(0, 3).join('/')}/...`;
    }

    const match = value.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!match) return this.maskUrl(value);

    const [, bucket, key] = match;
    return `s3://${bucket}/${key.split('/').slice(0, 3).join('/')}/...`;
  }
}
