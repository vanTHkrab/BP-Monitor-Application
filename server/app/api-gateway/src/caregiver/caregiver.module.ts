import { Module } from '@nestjs/common';
import { CaregiverResolver } from './caregiver.resolver';
import { CaregiverService } from './caregiver.service';

@Module({
  providers: [CaregiverResolver, CaregiverService],
})
export class CaregiverModule {}
