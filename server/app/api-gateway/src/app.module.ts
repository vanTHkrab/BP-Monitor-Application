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

// The spellings of GRAPHIQL_ENABLED that mean "serve GraphiQL". This is a
// closed allowlist, NOT a generic truthiness or boolean parse, and the
// difference is load-bearing: GraphiQL is a mutation-capable schema explorer
// pointed at live patient data, so an unrecognised value must resolve to OFF.
// A truthiness check would read `GRAPHIQL_ENABLED=false` as ON.
//
// Do not "simplify" this to `Boolean(raw)` or a parse that treats any
// non-empty value as a signal — `app.module.spec.ts` pins `false`, `no`,
// `off`, and `maybe` as off precisely to catch that change.
const GRAPHIQL_ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

// Resolve the `graphiql` option from the environment.
//
// - A recognised value turns it on; ANY other non-empty value turns it off.
// - Unset, empty, or whitespace-only defers to NODE_ENV: on everywhere except
//   production. This is the default that keeps a prod deploy from serving the
//   explorer to the internet.
//
// In the prod stack nginx additionally puts /graphiql behind Basic Auth — see
// infra/nginx/templates/default.conf.template. The two gates are not
// redundant; they fail differently.
const resolveGraphiqlEnabled = (raw: string | undefined): boolean => {
  const value = raw?.trim().toLowerCase() ?? '';
  if (value === '') {
    return process.env.NODE_ENV !== 'production';
  }
  return GRAPHIQL_ENABLED_VALUES.has(value);
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
      // GRAPHIQL_ENABLED is set to one of 1/true/yes/on; unchanged (on)
      // everywhere else. See `resolveGraphiqlEnabled` above for why the
      // accepted set is closed rather than a truthiness check.
      graphiql: resolveGraphiqlEnabled(process.env.GRAPHIQL_ENABLED),
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
