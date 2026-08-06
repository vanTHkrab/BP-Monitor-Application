import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';

// `auth.module` and `push.module` pull in `better-auth` and `expo-server-sdk`,
// which are ESM-only and cannot be parsed by the CJS Jest setup. They are
// stubbed here so that importing `AppModule` — needed to reach the GraphQL
// `errorFormatter` declared inline in its `imports` — does not drag the whole
// ESM graph into the transform. Nothing in this spec instantiates a Nest
// application, so an empty class is a sufficient stand-in.
jest.mock('./auth/auth.module', () => ({ AuthModule: class AuthModule {} }));
jest.mock('./push/push.module', () => ({ PushModule: class PushModule {} }));

import { AppModule } from './app.module';

type FormatterResult = {
  statusCode: number;
  response: {
    data: unknown;
    errors?: GraphQLFormattedError[];
  };
};

type ErrorFormatter = (execution: {
  data?: unknown;
  errors?: readonly GraphQLError[];
}) => FormatterResult;

/**
 * The formatter is not exported: it is a closure inside the options object
 * passed to `GraphQLModule.forRoot()` in `app.module.ts`. Reach it through the
 * DynamicModule's provider list rather than re-declaring it here — a copy of
 * the mapping in the spec would pass forever regardless of what production
 * does, which is the failure mode these tests exist to prevent.
 */
const resolveErrorFormatter = (): ErrorFormatter => {
  const imports = Reflect.getMetadata('imports', AppModule) as unknown[];
  const graphqlModule = imports.find(
    (entry): entry is { providers: { useValue?: unknown }[] } =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { module?: { name?: string } }).module?.name ===
        'GraphQLModule',
  );
  if (!graphqlModule) {
    throw new Error('GraphQLModule not found in AppModule imports');
  }
  const optionsProvider = graphqlModule.providers.find(
    (provider): provider is { useValue: { errorFormatter: ErrorFormatter } } =>
      typeof provider?.useValue === 'object' &&
      provider.useValue !== null &&
      typeof (provider.useValue as { errorFormatter?: unknown })
        .errorFormatter === 'function',
  );
  if (!optionsProvider) {
    throw new Error('GraphQL options provider with errorFormatter not found');
  }
  return optionsProvider.useValue.errorFormatter;
};

const wrap = (original: Error) =>
  new GraphQLError(original.message, { originalError: original });

describe('app.module errorFormatter', () => {
  const formatter = resolveErrorFormatter();
  const originalNodeEnv = process.env.NODE_ENV;

  const format = (errors: GraphQLError[], data: unknown = null) =>
    formatter({ data, errors });

  const extensionsOf = (original: Error): Record<string, unknown> =>
    (format([wrap(original)]).response.errors?.[0].extensions ?? {}) as Record<
      string,
      unknown
    >;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('status → extensions.code mapping', () => {
    // These strings are a client-visible API: client/lib/error-message.ts and
    // client/src/services/api.ts dispatch on them (401 fan-out, throttle
    // countdown, inline form errors). Renaming any right-hand value, or
    // remapping a status, is a breaking change for the mobile app and must
    // fail here.
    const cases: [string, HttpException, string][] = [
      ['400', new BadRequestException('bad'), 'BAD_USER_INPUT'],
      ['401', new UnauthorizedException('nope'), 'UNAUTHENTICATED'],
      ['403', new ForbiddenException('nope'), 'FORBIDDEN'],
      ['404', new NotFoundException('gone'), 'NOT_FOUND'],
      ['409', new ConflictException('duplicate phone'), 'CONFLICT'],
      [
        '429',
        new HttpException('throttled', HttpStatus.TOO_MANY_REQUESTS),
        'TOO_MANY_REQUESTS',
      ],
    ];

    it.each(cases)('maps HTTP %s to %s', (_status, exception, expectedCode) => {
      expect(extensionsOf(exception).code).toBe(expectedCode);
    });

    it('maps an unmapped 4xx to BAD_REQUEST', () => {
      // 422 is not in the switch; the default branch must treat sub-500 as a
      // client error rather than falling through to INTERNAL_SERVER_ERROR.
      expect(extensionsOf(new HttpException('unprocessable', 422)).code).toBe(
        'BAD_REQUEST',
      );
    });

    it('distinguishes a 5xx from a 4xx in the default branch', () => {
      expect(extensionsOf(new HttpException('boom', 500)).code).toBe(
        'INTERNAL_SERVER_ERROR',
      );
      expect(extensionsOf(new HttpException('down', 503)).code).toBe(
        'INTERNAL_SERVER_ERROR',
      );
    });

    it('codes a non-HttpException as INTERNAL_SERVER_ERROR', () => {
      expect(extensionsOf(new Error('unexpected')).code).toBe(
        'INTERNAL_SERVER_ERROR',
      );
    });

    it('codes an error with no originalError as INTERNAL_SERVER_ERROR', () => {
      const [error] = format([new GraphQLError('raw')]).response.errors ?? [];
      expect(error.extensions?.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('keeps a code already stamped on the error over the status mapping', () => {
      // Mercurius/graphql-js stamp their own codes (e.g. GRAPHQL_VALIDATION_FAILED)
      // before the formatter runs; the status mapping must not overwrite them.
      const error = new GraphQLError('bad query', {
        extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
        originalError: new BadRequestException('bad'),
      });
      expect(format([error]).response.errors?.[0].extensions?.code).toBe(
        'GRAPHQL_VALIDATION_FAILED',
      );
    });

    it('ignores a non-string existing code and falls back to the status mapping', () => {
      const error = new GraphQLError('bad query', {
        extensions: { code: 500 },
        originalError: new ConflictException('duplicate'),
      });
      expect(format([error]).response.errors?.[0].extensions?.code).toBe(
        'CONFLICT',
      );
    });
  });

  describe('custom-field lift from the HttpException body', () => {
    it('lifts retryAfterSec into extensions', () => {
      // client/src/services/api.ts reads extensions.retryAfterSec generically
      // for every operation to drive the throttle countdown. If the lift stops
      // happening the countdown silently disappears.
      const exception = new HttpException(
        { message: 'too many attempts', retryAfterSec: 42 },
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(extensionsOf(exception)).toEqual({
        code: 'TOO_MANY_REQUESTS',
        retryAfterSec: 42,
      });
    });

    it('drops the NestJS envelope keys statusCode and error', () => {
      const exception = new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'invalid',
        field: 'phone',
      });
      const extensions = extensionsOf(exception);
      // Asserted as absences explicitly: a positive assertion on `field`
      // would still pass if `statusCode` leaked back in.
      expect(extensions).not.toHaveProperty('statusCode');
      expect(extensions).not.toHaveProperty('error');
      expect(extensions).not.toHaveProperty('message');
      expect(extensions.field).toBe('phone');
    });

    it('lifts nothing when the exception body is a plain string', () => {
      expect(extensionsOf(new BadRequestException('just a string'))).toEqual({
        code: 'BAD_USER_INPUT',
      });
    });

    it('lifts nothing when the exception body is an array', () => {
      // A raw array response has no key/value shape to lift; the guard must
      // skip it rather than spreading array indices into extensions as "0",
      // "1", ... (note: `new BadRequestException([...])` does NOT reach this
      // branch — Nest nests the array under `message`, covered separately).
      expect(
        extensionsOf(new HttpException(['a', 'b'], HttpStatus.BAD_REQUEST)),
      ).toEqual({ code: 'BAD_USER_INPUT' });
    });
  });

  describe('message handling by NODE_ENV', () => {
    const validationException = () =>
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: ['phone must be a phone number', 'password is too short'],
      });

    it('surfaces a class-validator constraint array as validationErrors outside production', () => {
      process.env.NODE_ENV = 'development';
      expect(extensionsOf(validationException())).toEqual({
        code: 'BAD_USER_INPUT',
        validationErrors: [
          'phone must be a phone number',
          'password is too short',
        ],
      });
    });

    it('withholds validationErrors in production', () => {
      // The array carries raw input text back to the client; production must
      // not leak it. This assertion is the whole point of the NODE_ENV gate.
      process.env.NODE_ENV = 'production';
      expect(extensionsOf(validationException())).toEqual({
        code: 'BAD_USER_INPUT',
      });
    });

    it('never lifts a scalar message, even outside production', () => {
      process.env.NODE_ENV = 'development';
      const exception = new BadRequestException({
        message: 'a single string message',
      });
      expect(extensionsOf(exception)).toEqual({ code: 'BAD_USER_INPUT' });
    });

    it('still lifts sibling custom fields in production', () => {
      process.env.NODE_ENV = 'production';
      const exception = new HttpException(
        { statusCode: 429, message: ['throttled'], retryAfterSec: 30 },
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(extensionsOf(exception)).toEqual({
        code: 'TOO_MANY_REQUESTS',
        retryAfterSec: 30,
      });
    });
  });

  describe('the formatted envelope', () => {
    it('answers HTTP 200 with the error in the GraphQL body', () => {
      // GraphQL-over-HTTP: a 200 with an `errors` array. Returning a non-200
      // would make the client transport treat it as a network failure instead
      // of dispatching on extensions.code.
      const result = format([wrap(new ConflictException('duplicate'))]);
      expect(result.statusCode).toBe(200);
      expect(result.response.data).toBeNull();
    });

    it('preserves message, path and locations on each error', () => {
      const error = new GraphQLError('duplicate phone', {
        originalError: new ConflictException('duplicate phone'),
        path: ['register'],
      });
      const [formatted] = format([error]).response.errors ?? [];
      expect(formatted.message).toBe('duplicate phone');
      expect(formatted.path).toEqual(['register']);
    });

    it('formats every error in the execution, not just the first', () => {
      const result = format([
        wrap(new UnauthorizedException('nope')),
        wrap(new ConflictException('duplicate')),
      ]);
      expect(
        result.response.errors?.map((error) => error.extensions?.code),
      ).toEqual(['UNAUTHENTICATED', 'CONFLICT']);
    });

    it('passes partial data through alongside errors', () => {
      const result = format([wrap(new NotFoundException('gone'))], {
        me: { id: '1' },
      });
      expect(result.response.data).toEqual({ me: { id: '1' } });
    });

    it('normalises undefined data to null', () => {
      expect(formatter({ errors: [] }).response.data).toBeNull();
    });
  });
});
