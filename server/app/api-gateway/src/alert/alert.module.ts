import { Module } from '@nestjs/common';
import { CaregiverModule } from '../caregiver/caregiver.module';
import { StorageModule } from '../storage/storage.module';
import { AlertResolver } from './alert.resolver';
import { AlertService } from './alert.service';

@Module({
  // `CaregiverModule` exports `CaregiverService` for its
  // `assertCanActOnBehalfOf` guard — the same one `readings(patientId:)` uses.
  imports: [StorageModule, CaregiverModule],
  providers: [AlertResolver, AlertService],
})
export class AlertModule {}
