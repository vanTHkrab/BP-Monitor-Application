import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AiProcessor } from './ai.process';
import { AiResolver } from './ai.resolver';
import { AI_QUEUE, AiService } from './ai.service';

const redisPort = Number.parseInt(process.env.REDIS_PORT ?? '6379', 10);
const resolvedRedisPort = Number.isNaN(redisPort) ? 6379 : redisPort;
const redisHost = process.env.REDIS_HOST ?? 'localhost';

@Module({
  imports: [
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
  providers: [AiResolver, AiService, AiProcessor],
})
export class AiModule {}
