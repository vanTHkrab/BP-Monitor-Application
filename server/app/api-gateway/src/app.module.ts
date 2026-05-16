import { HttpException, Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, MercuriusDriverConfig } from '@nestjs/mercurius';
import { ClientsModule, Transport } from '@nestjs/microservices';
import type { GraphQLFormattedError } from 'graphql';
import { join } from 'path';

// Map a NestJS HttpException status to the Apollo-style string codes the
// mobile client (client/lib/error-message.ts) keys off of. Mercurius doesn't
// stamp these on its own.
const httpStatusToGqlCode = (status: number): string => {
  switch (status) {
    case 400:
      return 'BAD_USER_INPUT';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    default:
      return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST';
  }
};

import { AppResolver } from './app.resolver';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { ReadingModule } from './reading/reading.module';
import { PostModule } from './post/post.module';
import { AiModule } from './ai/ai.module';
import { StorageModule } from './storage/storage.module';
import { CommentModule } from './comment/comment.module';
import { AlertModule } from './alert/alert.module';
import { CaregiverModule } from './caregiver/caregiver.module';
import { DebugModule } from './debug/debug.module';

@Module({
  imports: [
    // == GraphQL Setup ==
    GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      graphiql: true,
      subscription: true,
      errorFormatter: (execution) => {
        const errors = execution.errors?.map((err): GraphQLFormattedError => {
          const original = err.originalError;
          const existingCode =
            typeof err.extensions?.code === 'string'
              ? err.extensions.code
              : null;
          const code =
            existingCode ??
            (original instanceof HttpException
              ? httpStatusToGqlCode(original.getStatus())
              : 'INTERNAL_SERVER_ERROR');

          // Lift custom fields from HttpException response body into extensions
          // so the client can dispatch on them (e.g. `retryAfterSec` from the
          // login / verify-password throttle). The NestJS envelope keys
          // (statusCode / error) are dropped — `code` already encodes status.
          // `message` is dropped in production (avoid leaking raw text) but
          // surfaced in dev as `validationErrors` when class-validator returns
          // its constraint array, so failed inputs are debuggable from logs.
          const extraExtensions: Record<string, unknown> = {};
          if (original instanceof HttpException) {
            const response = original.getResponse();
            if (
              response &&
              typeof response === 'object' &&
              !Array.isArray(response)
            ) {
              for (const [key, value] of Object.entries(
                response as Record<string, unknown>,
              )) {
                if (key === 'statusCode' || key === 'error') {
                  continue;
                }
                if (key === 'message') {
                  if (
                    process.env.NODE_ENV !== 'production' &&
                    Array.isArray(value)
                  ) {
                    extraExtensions.validationErrors = value;
                  }
                  continue;
                }
                extraExtensions[key] = value;
              }
            }
          }

          return {
            message: err.message,
            locations: err.locations,
            path: err.path,
            extensions: { ...err.extensions, ...extraExtensions, code },
          };
        });
        return {
          statusCode: 200,
          response: { data: execution.data ?? null, errors },
        };
      },
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
    // == Shared infrastructure ==
    RedisModule,
    // == Feature Modules ==
    AuthModule,
    ReadingModule,
    PostModule,
    AiModule,
    StorageModule,
    CommentModule,
    AlertModule,
    CaregiverModule,
    DebugModule,
  ],
  providers: [AppService, AppResolver],
})
export class AppModule {}
