import { Module } from '@nestjs/common';
import { CaregiverResolver } from './caregiver.resolver';
import { CaregiverService } from './caregiver.service';

@Module({
  providers: [CaregiverResolver, CaregiverService],
  exports: [CaregiverService],
})
export class CaregiverModule {}
