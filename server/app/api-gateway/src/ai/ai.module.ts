import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { StorageModule } from '../storage/storage.module';
import { AiProcessor } from './ai.process';
import { AiResolver } from './ai.resolver';
import { AI_QUEUE, AiService } from './ai.service';
import { redisConnectionFromEnv } from '../redis/redis-connection';
import { MetricsLogger } from './metrics-logger';

// Resolved inside factories, not at module import, so this matches when
// `REDIS_CLIENT`'s own `useFactory` runs. Both read the same `process.env`
// today, but resolving at two different *times* is the same shape of latent
// divergence this file was just fixed to remove — anything that populated
// `process.env` between import and DI instantiation would split them again.

@Module({
  imports: [
    // StorageModule exports S3StorageClient — AiService uses presignGet()
    // to attach a short-lived URL to the job payload so ai-service can
    // fetch the image without holding S3 credentials of its own.
    StorageModule,
    BullModule.forRootAsync({
      useFactory: () => ({ connection: redisConnectionFromEnv() }),
    }),
    BullModule.registerQueue({ name: AI_QUEUE }),
    ClientsModule.registerAsync([
      {
        name: 'AI_SERVICE',
        useFactory: () => ({
          transport: Transport.REDIS,
          options: redisConnectionFromEnv(),
        }),
      },
    ]),
  ],
  providers: [AiResolver, AiService, AiProcessor, MetricsLogger],
})
export class AiModule {}
