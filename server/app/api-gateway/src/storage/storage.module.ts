import { Module } from '@nestjs/common';
import { S3StorageClient } from './s3-storage.client';
import { s3ConfigProvider } from './s3.config';
import { StorageController } from './storage.controller';
import { StorageResolver } from './storage.resolver';
import { StorageService } from './storage.service';

@Module({
  controllers: [StorageController],
  providers: [
    s3ConfigProvider,
    S3StorageClient,
    StorageResolver,
    StorageService,
  ],
  exports: [S3StorageClient, StorageService],
})
export class StorageModule {}
