import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { DebugResolver } from './debug.resolver';
import { DebugService } from './debug.service';

@Module({
  imports: [AuthModule, StorageModule],
  providers: [DebugService, DebugResolver],
})
export class DebugModule {}
