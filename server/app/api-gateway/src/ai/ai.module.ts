import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { StorageModule } from '../storage/storage.module';
import { AiProcessor } from './ai.process';
import { AiResolver } from './ai.resolver';
import { AI_QUEUE, AiService } from './ai.service';
import { MetricsLogger } from './metrics-logger';

const redisPort = Number.parseInt(process.env.REDIS_PORT ?? '6379', 10);
const resolvedRedisPort = Number.isNaN(redisPort) ? 6379 : redisPort;
const redisHost = process.env.REDIS_HOST ?? 'localhost';

@Module({
  imports: [
    // StorageModule exports S3StorageClient — AiService uses presignGet()
    // to attach a short-lived URL to the job payload so ai-service can
    // fetch the image without holding S3 credentials of its own.
    StorageModule,
    BullModule.forRoot({
      connection: {
        host: redisHost,
        port: resolvedRedisPort,
      },
    }),
    BullModule.registerQueue({ name: AI_QUEUE }),
    ClientsModule.register([
      {
        name: 'AI_SERVICE',
        transport: Transport.REDIS,
        options: {
          host: redisHost,
          port: resolvedRedisPort,
        },
      },
    ]),
  ],
  providers: [AiResolver, AiService, AiProcessor, MetricsLogger],
})
export class AiModule {}
