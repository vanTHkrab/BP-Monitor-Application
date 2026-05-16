import { Injectable, Logger } from '@nestjs/common';
import { S3StorageClient } from './s3-storage.client';
import { ALLOWED_IMAGE_PREFIXES } from './types/storage.types';

const DEFAULT_SIGNED_URL_TTL_SEC = 600; // 10 minutes

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly s3: S3StorageClient) {}

  /**
   * Convert a stored avatar / image reference into a short-lived signed
   * GET URL clients can put straight on an `<img>` / RN `<Image>`. Accepts
   * either a bare S3 key (e.g. `users/uid/profile/avatar/uuid.jpg`) or a
   * fully-qualified URL produced by `S3StorageClient.publicUrl()`.
   *
   * Returns `null` when the input is empty, and the original value when it
   * can't be parsed into a recognized storage key — that path keeps
   * external URLs (e.g. social-login avatars) flowing through untouched.
   */
  async signImageKey(
    rawValue: string | null | undefined,
    expiresInSec: number = DEFAULT_SIGNED_URL_TTL_SEC,
  ): Promise<string | null> {
    if (!rawValue) return null;

    const key = this.extractStorageKey(rawValue);
    if (!key) return rawValue;

    try {
      return await this.s3.presignGet(key, expiresInSec);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`signImageKey failed key=${key} error=${name}`);
      return rawValue;
    }
  }

  /**
   * Normalize a value the client sent us (typically `S3StorageClient.publicUrl()`
   * returned during the upload-confirm step) down to the bare storage key
   * we want in the database. Stops signed URLs and their throwaway query
   * strings from being persisted.
   */
  normalizeStorageValue(rawValue: string | null | undefined): string | null {
    if (!rawValue) return null;
    return this.extractStorageKey(rawValue) ?? rawValue;
  }

  /**
   * Try to pull a `users/...` / `tmp/...` storage key out of either a raw
   * key, an `s3://bucket/key` URI, or an https URL whose path contains the
   * key. Returns null when no allowed prefix is found.
   */
  private extractStorageKey(rawValue: string): string | null {
    const raw = rawValue.trim();
    if (!raw) return null;

    const directPrefix = ALLOWED_IMAGE_PREFIXES.find((prefix) =>
      raw.startsWith(prefix),
    );
    if (directPrefix) {
      if (raw.includes('..')) return null;
      return raw;
    }

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }

    const decode = (value: string) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    const path = decode(parsed.pathname.replace(/^\/+/, ''));
    if (path.includes('..')) return null;

    if (parsed.protocol === 's3:') {
      return ALLOWED_IMAGE_PREFIXES.some((prefix) => path.startsWith(prefix))
        ? path
        : null;
    }

    for (const prefix of ALLOWED_IMAGE_PREFIXES) {
      const index = path.indexOf(prefix);
      if (index >= 0) return path.slice(index);
    }
    return null;
  }
}
