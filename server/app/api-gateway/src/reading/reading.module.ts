import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ReadingService } from './reading.service';
import { ReadingResolver } from './reading.resolver';

@Module({
  imports: [StorageModule],
  providers: [ReadingService, ReadingResolver],
})
export class ReadingModule {}
