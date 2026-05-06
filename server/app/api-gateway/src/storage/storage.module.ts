import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageResolver } from './storage.resolver';
import { StorageService } from './storage.service';

@Module({
  controllers: [StorageController],
  providers: [StorageResolver, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
