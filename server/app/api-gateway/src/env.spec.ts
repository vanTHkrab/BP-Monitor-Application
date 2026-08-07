import { isProduction } from './env';

/**
 * `isProduction()` is the single predicate behind eight production kill
 * switches, reached from six read sites: the `debugMyStorage` diff, the
 * GraphiQL explorer, the `validationErrors` echo, unrestricted CORS, the
 * token-path 404 log, and three fail-fast guards in `better-auth.ts` (missing
 * BETTER_AUTH_URL, email delivery, SMS delivery) that share a single read.
 * A wrong answer here opens all eight at once and logs nothing, which is why
 * the casing and whitespace cases below are pinned individually rather than
 * left to the call sites.
 *
 * Only three of the six read sites have a spec that exercises them through
 * production code — `debug.service.ts` and both in `app.module.ts`. The other
 * three (`main.ts`, `better-auth.controller.ts`, `better-auth.ts`) are covered
 * only by this file, so these cases are the whole guarantee for them.
 */
describe('isProduction', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  const setNodeEnv = (value: string | undefined) => {
    if (value === undefined) {
      // `delete`, not `= undefined`: assigning undefined stores the *string*
      // "undefined", which would leak a bogus NODE_ENV into every later suite
      // and, being neither 'production' nor absent, silently pass the unset
      // case for the wrong reason.
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = value;
    }
  };

  afterEach(() => {
    setNodeEnv(originalNodeEnv);
  });

  describe('values that mean production', () => {
    // The defect this helper exists to fix: `'PRODUCTION' !== 'production'`,
    // so an exact comparison sent a deploy that set the variable in the wrong
    // case straight into the development branch of all eight gates. These are
    // spellings an operator plausibly types, not exotic input.
    it.each([
      'production',
      'PRODUCTION',
      'Production',
      'ProDuCtIoN',
      '  production  ',
      '\tproduction\n',
      '  PRODUCTION  ',
    ])('treats %j as production', (value) => {
      setNodeEnv(value);
      expect(isProduction()).toBe(true);
    });
  });

  describe('values that do not mean production', () => {
    it.each(['development', 'DEVELOPMENT', 'test', 'staging', 'prod', 'dev'])(
      'treats %j as non-production',
      (value) => {
        setNodeEnv(value);
        expect(isProduction()).toBe(false);
      },
    );

    // `prod` above is deliberate and load-bearing: normalisation trims and
    // lowercases, it does not fuzzy-match. Accepting a prefix would make
    // `production-eu` production too, and the helper has no business guessing.
    it('does not match a value that merely contains "production"', () => {
      setNodeEnv('not-production');
      expect(isProduction()).toBe(false);
      setNodeEnv('production-eu');
      expect(isProduction()).toBe(false);
    });

    it.each(['', ' ', '\t'])(
      'treats an empty or whitespace-only %j as non-production',
      (value) => {
        setNodeEnv(value);
        expect(isProduction()).toBe(false);
      },
    );

    it('treats an unset NODE_ENV as non-production', () => {
      // A bare `pnpm start` sets nothing. Every call site's non-production
      // branch is the developer-friendly one — CORS open, GraphiQL served,
      // delivery stubs logging — so this must not flip to a production
      // posture, and equally the eight gates must not close on a local run.
      setNodeEnv(undefined);
      expect(isProduction()).toBe(false);
    });
  });

  it('returns a boolean, never a truthy string', () => {
    // Call sites use the result directly as a Mercurius option value
    // (`graphiql: !isProduction()`), where any truthy value means "serve it".
    setNodeEnv('production');
    expect(typeof isProduction()).toBe('boolean');
    setNodeEnv(undefined);
    expect(typeof isProduction()).toBe('boolean');
  });

  it('re-reads process.env on every call rather than memoising', () => {
    // `debug.service.spec.ts` pins that one service instance answers both ways
    // as NODE_ENV changes, and `app.module.spec.ts` re-imports the module per
    // case. A helper that cached its first answer would satisfy every
    // single-call test above and quietly break both of those guarantees — and
    // in production would freeze whichever value happened to be set at the
    // first import.
    setNodeEnv('development');
    expect(isProduction()).toBe(false);
    setNodeEnv('production');
    expect(isProduction()).toBe(true);
    setNodeEnv('development');
    expect(isProduction()).toBe(false);
  });
});
