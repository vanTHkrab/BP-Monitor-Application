import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, MercuriusDriverConfig } from '@nestjs/mercurius';
import { ClientsModule, Transport } from '@nestjs/microservices';
import Redis from 'ioredis';
import { join } from 'path';

import { AppResolver } from './app.resolver';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AiServiceResolver } from './ai-service/ai-service.resolver';
import { AiServiceService } from './ai-service/ai-service.service';
import { AuthModule } from './auth/auth.module';
import { ReadingModule } from './reading/reading.module';
import { PostModule } from './post/post.module';

@Module({
  imports: [
    // == GraphQL Setup ==
    GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      graphiql: true,
      subscription: true,
    }),
    // == Microservice Clients ==
    ClientsModule.register([
      // Register the AI Service as a microservice client using Redis transport
      {
        name: 'AI_SERVICE',
        transport: Transport.REDIS,
        options: {
          port: 6379,
        },
      },
    ]),
    // == Database Module ==
    PrismaModule,
    // == Feature Modules ==
    AuthModule,
    ReadingModule,
    PostModule,
  ],
  providers: [
    {
      // Create a Redis client instance and provide it for injection
      // lazyConnect: won't throw if Redis is unavailable (AI Service is optional)
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        const redis = new Redis({
          host: 'localhost',
          port: 6379,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null, // don't retry — Redis is optional
        });
        redis.on('error', () => {}); // suppress connection errors
        redis.connect().catch(() => {}); // attempt connect but don't fail
        return redis;
      },
    },
    // == Core App Providers ==
    AppService,
    AppResolver,
    // == AI Service Providers ==
    AiServiceService,
    AiServiceResolver,
  ],
})
export class AppModule {}

