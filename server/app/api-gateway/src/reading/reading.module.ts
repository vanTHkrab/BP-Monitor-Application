import { Module } from '@nestjs/common';
import { ReadingService } from './reading.service';
import { ReadingResolver } from './reading.resolver';

@Module({
  providers: [ReadingService, ReadingResolver],
})
export class ReadingModule {}
