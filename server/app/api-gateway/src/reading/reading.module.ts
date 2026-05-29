import { Module } from '@nestjs/common';
import { CaregiverModule } from '../caregiver/caregiver.module';
import { StorageModule } from '../storage/storage.module';
import { ReadingService } from './reading.service';
import { ReadingResolver } from './reading.resolver';

@Module({
  imports: [StorageModule, CaregiverModule],
  providers: [ReadingService, ReadingResolver],
})
export class ReadingModule {}
