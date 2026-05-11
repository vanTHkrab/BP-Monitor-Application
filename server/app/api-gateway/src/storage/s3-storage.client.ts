import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { S3_CONFIG, type S3Config } from './s3.config';

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string | Readable;
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
  cacheControl?: string;
}

export interface PutObjectResult {
  key: string;
  bucket: string;
  etag?: string;
}

export interface GetObjectResult {
  body: Readable;
  contentType: string;
  contentLength?: number;
  metadata?: Record<string, string>;
  lastModified?: Date;
  etag?: string;
}

export interface HeadObjectResult {
  contentType: string;
  contentLength: number;
  lastModified?: Date;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface ListedObject {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
}

export interface ListObjectsResult {
  items: ListedObject[];
  nextContinuationToken?: string;
  isTruncated: boolean;
}

export interface ListObjectsInput {
  prefix: string;
  continuationToken?: string;
  maxKeys?: number;
}

/**
 * Thin wrapper over @aws-sdk/client-s3 — transport only.
 * No Prisma, no domain knowledge of folders/policies.
 * Callers compose business rules on top.
 */
@Injectable()
export class S3StorageClient {
  private readonly logger = new Logger(S3StorageClient.name);
  private readonly client: S3Client;

  constructor(@Inject(S3_CONFIG) private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    this.logger.log(
      `S3 client ready provider=${config.provider ?? 's3'} bucket=${config.bucket} region=${config.region} endpoint=${this.maskEndpoint(config.endpoint)} pathStyle=${config.forcePathStyle}`,
    );
  }

  get bucket(): string {
    return this.config.bucket;
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const key = this.normalizeKey(input.key);
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
        Metadata: input.metadata,
        CacheControl: input.cacheControl,
      }),
    );

    return {
      key,
      bucket: this.config.bucket,
      etag: result.ETag,
    };
  }

  async get(key: string): Promise<GetObjectResult> {
    const normalizedKey = this.normalizeKey(key);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: normalizedKey,
      }),
    );

    if (!result.Body) {
      throw new Error(`Empty body for object ${normalizedKey}`);
    }

    return {
      body: result.Body as Readable,
      contentType: result.ContentType ?? 'application/octet-stream',
      contentLength: result.ContentLength,
      metadata: result.Metadata,
      lastModified: result.LastModified,
      etag: result.ETag,
    };
  }

  async head(key: string): Promise<HeadObjectResult | null> {
    const normalizedKey = this.normalizeKey(key);
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: normalizedKey,
        }),
      );
      return {
        contentType: result.ContentType ?? 'application/octet-stream',
        contentLength: result.ContentLength ?? 0,
        lastModified: result.LastModified,
        etag: result.ETag,
        metadata: result.Metadata,
      };
    } catch (err) {
      if (err instanceof NotFound || err instanceof NoSuchKey) {
        return null;
      }
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: this.normalizeKey(key),
      }),
    );
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    // S3 caps DeleteObjects at 1000 keys per request.
    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += 1000) {
      chunks.push(keys.slice(i, i + 1000));
    }
    for (const chunk of chunks) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: {
            Objects: chunk.map((k) => ({ Key: this.normalizeKey(k) })),
            Quiet: true,
          },
        }),
      );
    }
  }

  async list(input: ListObjectsInput): Promise<ListObjectsResult> {
    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: input.prefix,
        ContinuationToken: input.continuationToken,
        MaxKeys: input.maxKeys,
      }),
    );

    const items: ListedObject[] = (result.Contents ?? [])
      .filter((item) => item.Key && !item.Key.endsWith('/'))
      .map((item) => ({
        key: item.Key as string,
        size: item.Size ?? 0,
        lastModified: item.LastModified,
        etag: item.ETag,
      }));

    return {
      items,
      nextContinuationToken: result.NextContinuationToken,
      isTruncated: result.IsTruncated ?? false,
    };
  }

  async *listAll(prefix: string, pageSize = 1000): AsyncIterable<ListedObject> {
    let token: string | undefined;
    do {
      const page = await this.list({
        prefix,
        continuationToken: token,
        maxKeys: pageSize,
      });
      for (const item of page.items) yield item;
      token = page.nextContinuationToken;
    } while (token);
  }

  publicUrl(key: string): string {
    const normalizedKey = this.normalizeKey(key);
    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${normalizedKey}`;
    }
    const base = this.config.endpoint.replace(/\/$/, '');
    return this.config.forcePathStyle
      ? `${base}/${this.config.bucket}/${normalizedKey}`
      : `${base.replace(/^https?:\/\//, (m) => `${m}${this.config.bucket}.`)}/${normalizedKey}`;
  }

  storageUri(key: string): string {
    return `s3://${this.config.bucket}/${this.normalizeKey(key)}`;
  }

  private normalizeKey(key: string): string {
    const trimmed = key.replace(/^\/+/, '');
    if (!trimmed) {
      throw new Error('S3 key cannot be empty');
    }
    if (trimmed.includes('..')) {
      throw new Error(`S3 key contains illegal segment: ${key}`);
    }
    return trimmed;
  }

  private maskEndpoint(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch {
      return '[invalid-endpoint]';
    }
  }
}
