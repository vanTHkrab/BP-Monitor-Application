import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AlertResolver } from './alert.resolver';
import { AlertService } from './alert.service';

@Module({
  imports: [StorageModule],
  providers: [AlertResolver, AlertService],
})
export class AlertModule {}
