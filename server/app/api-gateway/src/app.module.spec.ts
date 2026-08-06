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
import { GraphQLError, Source, type GraphQLFormattedError } from 'graphql';

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

type GraphQLOptions = {
  errorFormatter: ErrorFormatter;
  graphiql: unknown;
};

/**
 * Neither the formatter nor the `graphiql` flag is exported: both live in the
 * options object passed to `GraphQLModule.forRoot()` in `app.module.ts`. Reach
 * them through the DynamicModule's provider list rather than re-declaring them
 * here — a copy of the mapping in the spec would pass forever regardless of
 * what production does, which is the failure mode these tests exist to
 * prevent.
 *
 * Takes the module class as an argument rather than closing over the
 * top-level import, because the `graphiql` suite re-imports `app.module` under
 * a different environment and must resolve options off the *fresh* class.
 */
const resolveGraphQLOptions = (moduleClass: object): GraphQLOptions => {
  const imports = Reflect.getMetadata('imports', moduleClass) as unknown[];
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
    (provider): provider is { useValue: GraphQLOptions } =>
      typeof provider?.useValue === 'object' &&
      provider.useValue !== null &&
      typeof (provider.useValue as { errorFormatter?: unknown })
        .errorFormatter === 'function',
  );
  if (!optionsProvider) {
    throw new Error('GraphQL options provider with errorFormatter not found');
  }
  return optionsProvider.useValue;
};

const resolveErrorFormatter = (): ErrorFormatter =>
  resolveGraphQLOptions(AppModule).errorFormatter;

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
    // These strings are a client-visible API. `client/src/modules/auth/lib/
    // errors.ts` dispatches on UNAUTHENTICATED, TOO_MANY_REQUESTS, FORBIDDEN,
    // CONFLICT, and BAD_USER_INPUT; `client/src/services/api.ts` reads
    // `extensions.retryAfterSec` generically for every operation (401 fan-out,
    // throttle countdown, inline form errors). Renaming any right-hand value, or
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
        // `positions` + `source` are what make `locations` non-empty. Without
        // them the test name promised `locations` and never checked it — a
        // reviewer's mutant replacing it with `undefined` survived. A test
        // name is a claim in exactly the way a comment is.
        positions: [7],
        source: new Source('{ register }'),
      });
      const [formatted] = format([error]).response.errors ?? [];
      expect(formatted.message).toBe('duplicate phone');
      expect(formatted.path).toEqual(['register']);
      expect(formatted.locations).toEqual([{ line: 1, column: 8 }]);
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

describe('app.module graphiql gate', () => {
  // GraphiQL is a mutation-capable schema explorer pointed at whatever
  // database the process holds. Serving it from a production deploy exposes
  // every mutation in the schema against live patient data, so the default
  // must be off there. Nothing else in the suite asserts this: a mutant that
  // inverts the gate compiles, boots, and passes every other test.
  //
  // The ternary evaluates once, at module load, inside the object literal
  // passed to `GraphQLModule.forRoot()`. Mutating `process.env` afterwards
  // and re-reading the resolved value proves nothing — each case must reset
  // the module registry, set the environment, and re-import `app.module`.
  const originalGraphiqlEnabled = process.env.GRAPHIQL_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  const setEnv = (key: string, value: string | undefined) => {
    if (value === undefined) {
      // `delete`, not `= undefined`: assigning undefined stringifies to
      // "undefined", which is truthy and would take the explicit-opt-in arm
      // of the ternary in every case that runs after it.
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  /**
   * Re-imports `app.module` under the given environment and returns the
   * resolved `graphiql` option. `jest.requireActual` is used rather than a
   * bare `require` for its type, and it un-mocks only `./app.module` itself —
   * the `auth.module` / `push.module` mocks registered at the top of this file
   * survive `resetModules()` and still shield the ESM-only graph.
   */
  const resolveGraphiql = (env: {
    GRAPHIQL_ENABLED?: string;
    NODE_ENV?: string;
  }): unknown => {
    setEnv('GRAPHIQL_ENABLED', env.GRAPHIQL_ENABLED);
    setEnv('NODE_ENV', env.NODE_ENV);
    jest.resetModules();
    const fresh =
      jest.requireActual<typeof import('./app.module')>('./app.module');
    return resolveGraphQLOptions(fresh.AppModule).graphiql;
  };

  afterEach(() => {
    setEnv('GRAPHIQL_ENABLED', originalGraphiqlEnabled);
    setEnv('NODE_ENV', originalNodeEnv);
    jest.resetModules();
  });

  it('keeps the auth/push mocks alive across resetModules', () => {
    // The rest of this suite is only meaningful if re-importing app.module
    // does not drag `better-auth` / `expo-server-sdk` into the CJS transform.
    // If this ever fails, the other cases here fail as parse errors and the
    // cause is not obvious from the output.
    expect(() => resolveGraphiql({ NODE_ENV: 'production' })).not.toThrow();
  });

  describe('explicit GRAPHIQL_ENABLED overrides the NODE_ENV default', () => {
    // The accepted set is closed: 1 / true / yes / on, case-insensitive and
    // whitespace-trimmed. Widening it is a security decision, so each accepted
    // spelling is pinned individually rather than generated from the
    // production-side constant — deriving the cases from the code under test
    // would make any widening self-approving.
    it.each(['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'on', '  true  '])(
      'serves GraphiQL in production when GRAPHIQL_ENABLED=%j',
      (value) => {
        expect(
          resolveGraphiql({ GRAPHIQL_ENABLED: value, NODE_ENV: 'production' }),
        ).toBe(true);
      },
    );

    it.each(['0', 'false', 'FALSE', 'no', 'off', ' off '])(
      'withholds GraphiQL in development when GRAPHIQL_ENABLED=%j',
      (value) => {
        expect(
          resolveGraphiql({ GRAPHIQL_ENABLED: value, NODE_ENV: 'development' }),
        ).toBe(false);
      },
    );
  });

  describe('the NODE_ENV default when GRAPHIQL_ENABLED is unset', () => {
    it('withholds GraphiQL in production', () => {
      // The load-bearing assertion. Inverting the gate — `=== 'production'`
      // instead of `!== 'production'` — makes only this case and the
      // development case below fail.
      expect(resolveGraphiql({ NODE_ENV: 'production' })).toBe(false);
    });

    it('serves GraphiQL in development', () => {
      expect(resolveGraphiql({ NODE_ENV: 'development' })).toBe(true);
    });

    it('serves GraphiQL when NODE_ENV is unset too', () => {
      // A bare `pnpm start` sets no NODE_ENV; the default must be the
      // developer-friendly one rather than an accidental production posture.
      expect(resolveGraphiql({})).toBe(true);
    });

    it('serves GraphiQL under the test environment', () => {
      expect(resolveGraphiql({ NODE_ENV: 'test' })).toBe(true);
    });
  });

  describe('an unrecognised value resolves to off, never to truthiness', () => {
    // THE regression guard for this gate. A non-empty value is truthy, so any
    // implementation that reaches for `Boolean(raw)` or "non-empty means the
    // operator opted in" passes every other case in this file and then serves
    // a mutation-capable schema explorer against live patient data for
    // GRAPHIQL_ENABLED=false. Unrecognised must mean off, in BOTH directions:
    // asserting only the production side would let a truthiness "fix" survive
    // by looking correct wherever the NODE_ENV default already says off.
    it.each(['maybe', 'enabled', '2', 'ON!', 'yes please', '-1', 'null'])(
      'withholds GraphiQL in production when GRAPHIQL_ENABLED=%j',
      (value) => {
        expect(
          resolveGraphiql({ GRAPHIQL_ENABLED: value, NODE_ENV: 'production' }),
        ).toBe(false);
      },
    );

    it.each(['maybe', 'enabled', '2', 'ON!', 'yes please', '-1', 'null'])(
      'withholds GraphiQL in development too when GRAPHIQL_ENABLED=%j',
      (value) => {
        // In development the NODE_ENV default is on, so this case can only
        // pass if the unrecognised value is actually being rejected rather
        // than falling through.
        expect(
          resolveGraphiql({ GRAPHIQL_ENABLED: value, NODE_ENV: 'development' }),
        ).toBe(false);
      },
    );
  });

  describe('an empty GRAPHIQL_ENABLED falls through to the NODE_ENV default', () => {
    // `GRAPHIQL_ENABLED=` in a .env file yields '', which carries no opinion,
    // so it is deliberately indistinguishable from unset — the committed
    // `.env.example` ships exactly that line. Whitespace-only is trimmed to
    // the same thing rather than being treated as an unrecognised value,
    // because ` ` in a .env file is a typo, not an instruction.
    it.each(['', ' ', '\t'])(
      'withholds GraphiQL in production when GRAPHIQL_ENABLED=%j',
      (value) => {
        expect(
          resolveGraphiql({ GRAPHIQL_ENABLED: value, NODE_ENV: 'production' }),
        ).toBe(false);
      },
    );

    it.each(['', ' ', '\t'])(
      'serves GraphiQL in development when GRAPHIQL_ENABLED=%j',
      (value) => {
        expect(
          resolveGraphiql({ GRAPHIQL_ENABLED: value, NODE_ENV: 'development' }),
        ).toBe(true);
      },
    );
  });

  it('resolves to a boolean, never a bare string', () => {
    // Mercurius treats any truthy value as "serve it". If the gate ever
    // returned `process.env.GRAPHIQL_ENABLED` directly, '0' would be a truthy
    // string and read as ON.
    expect(
      typeof resolveGraphiql({ GRAPHIQL_ENABLED: '0', NODE_ENV: 'production' }),
    ).toBe('boolean');
  });
});
