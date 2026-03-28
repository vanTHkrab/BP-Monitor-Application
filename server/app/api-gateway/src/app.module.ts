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
  ],
  providers: [
    // == Infrastructure Providers ==
    {
      // Create a Redis client instance and provide it for injection
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis({
          host: 'localhost',
          port: 6379,
        });
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
