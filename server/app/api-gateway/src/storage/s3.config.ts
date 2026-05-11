import 'dotenv/config';
import { FactoryProvider } from '@nestjs/common';

export const S3_CONFIG = Symbol('S3_CONFIG');

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl?: string;
  provider?: string;
}

export const s3ConfigProvider: FactoryProvider<S3Config> = {
  provide: S3_CONFIG,
  useFactory: (): S3Config => {
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET_NAME;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Missing S3 config. Required: S3_ENDPOINT, S3_BUCKET_NAME, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.',
      );
    }

    return {
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: process.env.S3_DEFAULT_REGION || 'auto',
      forcePathStyle: process.env.S3_USE_PATH_STYLE_ENDPOINT === 'true',
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
      provider: process.env.S3_PROVIDER,
    };
  },
};
