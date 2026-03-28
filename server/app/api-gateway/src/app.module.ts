import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, MercuriusDriverConfig } from '@nestjs/mercurius';
import { ClientsModule, Transport } from '@nestjs/microservices';
import Redis from 'ioredis';
import { join } from 'path';

import { AppResolver } from './app.resolver';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      graphiql: true,
      subscription: true,
    }),
    ClientsModule.register([
      {
        name: 'AI_SERVICE',
        transport: Transport.REDIS,
        options: {
          port: 6379,
        },
      },
    ]),
    PrismaModule,
  ],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis({
          host: 'localhost',
          port: 6379,
        });
      },
    },
    AppService,
    AppResolver,
  ],
})
export class AppModule {}
