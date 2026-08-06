import { HttpException, Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, MercuriusDriverConfig } from '@nestjs/mercurius';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import type { GraphQLFormattedError } from 'graphql';
import { join } from 'path';

// Map a NestJS HttpException status to the Apollo-style string codes the
// mobile client keys off of. Mercurius doesn't stamp these on its own.
//
// The consumer is `client/src/modules/auth/lib/errors.ts`, which dispatches on
// UNAUTHENTICATED, TOO_MANY_REQUESTS, FORBIDDEN, CONFLICT, and BAD_USER_INPUT.
// (This comment used to name `client/lib/error-message.ts` — both the wrong
// path and the wrong file. That one handles only the transport-level
// NETWORK_TIMEOUT / NETWORK_FAILED and never sees a gateway code.)
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
    // Both of these used to fall through to BAD_REQUEST, which the client
    // renders as a generic validation failure: a duplicate phone showed the
    // wrong message, and a throttled request showed no countdown.
    case 409:
      return 'CONFLICT';
    case 429:
      return 'TOO_MANY_REQUESTS';
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
import { SecurityModule } from './security/security.module';
import { WellKnownController } from './well-known.controller';
import { PushModule } from './push/push.module';

@Module({
  imports: [
    // == GraphQL Setup ==
    GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      // GraphiQL is a schema explorer with full mutation access to whatever
      // database the process is pointed at, so it must not be served by
      // default on an internet-facing deploy. Off in production unless
      // GRAPHIQL_ENABLED=1 is set explicitly; unchanged (on) everywhere else.
      // In the prod stack nginx additionally puts /graphiql behind Basic Auth
      // — see infra/nginx/templates/default.conf.template.
      graphiql: process.env.GRAPHIQL_ENABLED
        ? process.env.GRAPHIQL_ENABLED === '1'
        : process.env.NODE_ENV !== 'production',
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
    // == Scheduler ==
    // Powers @Cron-decorated handlers (StorageCleanupService orphan sweep,
    // etc.). Discovery is global once `forRoot()` is called — feature
    // modules just declare the service as a provider.
    ScheduleModule.forRoot(),
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
    SecurityModule,
    PushModule,
  ],
  providers: [AppService, AppResolver],
  controllers: [WellKnownController],
})
export class AppModule {}
