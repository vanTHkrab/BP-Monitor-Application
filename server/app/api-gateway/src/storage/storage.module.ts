import { Module } from '@nestjs/common';
import { PresignedUploadService } from './presigned-upload.service';
import { S3StorageClient } from './s3-storage.client';
import { s3ConfigProvider } from './s3.config';
import { StorageResolver } from './storage.resolver';
import { StorageService } from './storage.service';

@Module({
  providers: [
    s3ConfigProvider,
    S3StorageClient,
    StorageResolver,
    StorageService,
    PresignedUploadService,
  ],
  exports: [S3StorageClient, StorageService, PresignedUploadService],
})
export class StorageModule {}
