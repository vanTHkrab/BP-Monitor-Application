import { Module } from '@nestjs/common';
import { CaregiverModule } from '../caregiver/caregiver.module';
import { PushModule } from '../push/push.module';
import { StorageModule } from '../storage/storage.module';
import { ReadingService } from './reading.service';
import { ReadingResolver } from './reading.resolver';

@Module({
  imports: [StorageModule, CaregiverModule, PushModule],
  providers: [ReadingService, ReadingResolver],
})
export class ReadingModule {}
