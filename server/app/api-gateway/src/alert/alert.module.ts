import { Module } from '@nestjs/common';
import { AlertResolver } from './alert.resolver';
import { AlertService } from './alert.service';

@Module({
  providers: [AlertResolver, AlertService],
})
export class AlertModule {}
