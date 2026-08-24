import { deriveGoogleName } from './google-profile-name';

/**
 * `deriveGoogleName` runs inside the Google OAuth callback, before a single
 * SQL statement is issued, and every failure it can have surfaces to the user
 * as "sign-in is broken" with no other signal. It is also the only piece of
 * `better-auth.ts`'s profile mapping that can be tested at all — that file
 * imports ESM-only packages the CJS Jest setup cannot parse, which is why this
 * function was extracted into its own file.
 *
 * The contract it has to keep, and that each case below pins:
 *
 * - `firstname` and `lastname` are NOT NULL `VARCHAR(100)` — so both are
 *   always strings, and neither ever exceeds 100 characters.
 * - `lastname` is legitimately `''` for a mononym. `''` satisfies the column
 *   and `` `${firstname} ${lastname}`.trim() `` renders correctly, whereas a
 *   placeholder would invent a surname the account holder does not have.
 * - A malformed claim produces a thin name, not a throw. A 500 here is a
 *   locked-out user; a blank surname is a cosmetic problem.
 */
describe('deriveGoogleName', () => {
  describe('the structured claims', () => {
    it('uses given_name and family_name when Google sends both', () => {
      expect(
        deriveGoogleName({
          given_name: 'Ada',
          family_name: 'Lovelace',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
        }),
      ).toEqual({ firstname: 'Ada', lastname: 'Lovelace' });
    });

    it('trims surrounding whitespace off both halves', () => {
      expect(
        deriveGoogleName({ given_name: '  Ada  ', family_name: ' Lovelace ' }),
      ).toEqual({ firstname: 'Ada', lastname: 'Lovelace' });
    });

    // The structured claims win outright: `name` is a display string Google
    // composes, and preferring it would let a locale that orders the surname
    // first swap the two columns.
    it('prefers the structured claims over a disagreeing name', () => {
      expect(
        deriveGoogleName({
          given_name: 'Ada',
          family_name: 'Lovelace',
          name: 'Lovelace Ada',
        }),
      ).toEqual({ firstname: 'Ada', lastname: 'Lovelace' });
    });
  });

  describe('falling back to the display name', () => {
    it('splits name into a first token and the rest', () => {
      expect(deriveGoogleName({ name: 'Ada King Lovelace' })).toEqual({
        firstname: 'Ada',
        lastname: 'King Lovelace',
      });
    });

    // The fallback is applied per half, not all-or-nothing. Treating the two
    // together would discard a recoverable surname whenever Google sent
    // `given_name` without `family_name`.
    it('recovers a surname from name when only family_name is missing', () => {
      expect(
        deriveGoogleName({ given_name: 'Ada', name: 'Ada King Lovelace' }),
      ).toEqual({ firstname: 'Ada', lastname: 'King Lovelace' });
    });

    it('ignores runs of whitespace when splitting name', () => {
      expect(deriveGoogleName({ name: '  Ada\t\n  Lovelace  ' })).toEqual({
        firstname: 'Ada',
        lastname: 'Lovelace',
      });
    });
  });

  describe('a mononym', () => {
    // `''` is the designed answer, not an oversight: the column is NOT NULL,
    // `''` satisfies it, and the rendered display name is just "Prince".
    // Repeating the given name or writing a placeholder would invent a
    // surname the account holder does not have.
    it('leaves lastname empty rather than inventing one', () => {
      expect(deriveGoogleName({ name: 'Prince' })).toEqual({
        firstname: 'Prince',
        lastname: '',
      });
    });

    it('leaves lastname empty when only given_name is present', () => {
      expect(
        deriveGoogleName({ given_name: 'Prince', email: 'p@example.com' }),
      ).toEqual({ firstname: 'Prince', lastname: '' });
    });

    // The email local part is the last resort for `firstname` only — never
    // for `lastname`, which would put an address fragment in a surname.
    it('never falls back to the email for lastname', () => {
      expect(
        deriveGoogleName({ name: 'Prince', email: 'p.q@example.com' }),
      ).toEqual({ firstname: 'Prince', lastname: '' });
    });
  });

  describe('no name claims at all', () => {
    // `firstname` is the display identity; a blank one renders as an account
    // with no name whatsoever, which is worse than an ugly one.
    it('falls back to the email local part for firstname', () => {
      expect(deriveGoogleName({ email: 'ada.lovelace@example.com' })).toEqual({
        firstname: 'ada.lovelace',
        lastname: '',
      });
    });

    it('returns two empty strings when there is nothing to derive from', () => {
      expect(deriveGoogleName({})).toEqual({ firstname: '', lastname: '' });
    });
  });

  describe('the column width', () => {
    // An over-long value fails the insert with a Postgres length error
    // *during the OAuth callback*, so the user sees "sign-in is broken" with
    // nothing linking it to their name. 100 is the VARCHAR width.
    it('truncates firstname to 100 characters', () => {
      const { firstname } = deriveGoogleName({ given_name: 'a'.repeat(250) });

      expect(firstname).toHaveLength(100);
      expect(firstname).toBe('a'.repeat(100));
    });

    it('truncates lastname to 100 characters', () => {
      const { lastname } = deriveGoogleName({
        given_name: 'Ada',
        family_name: 'b'.repeat(250),
      });

      expect(lastname).toHaveLength(100);
    });

    // The truncation has to survive the fallback path too — a long `name` is
    // exactly as capable of overflowing the column as a long `family_name`.
    it('truncates a name derived from the display name', () => {
      const { firstname, lastname } = deriveGoogleName({
        name: `${'a'.repeat(250)} ${'b'.repeat(250)}`,
      });

      expect(firstname).toHaveLength(100);
      expect(lastname).toHaveLength(100);
    });

    it('truncates a name derived from the email local part', () => {
      const { firstname } = deriveGoogleName({
        email: `${'a'.repeat(250)}@example.com`,
      });

      expect(firstname).toHaveLength(100);
    });
  });

  describe('malformed claims', () => {
    // Google's own types declare these as required strings; a malformed or
    // truncated token still delivers something else. Throwing here would turn
    // a cosmetic problem into a user who cannot sign in at all.
    it.each([
      ['numbers', { given_name: 1, family_name: 2, name: 3, email: 4 }],
      [
        'nulls',
        { given_name: null, family_name: null, name: null, email: null },
      ],
      ['objects', { given_name: {}, family_name: [], name: {}, email: [] }],
      [
        'booleans',
        { given_name: false, family_name: true, name: false, email: true },
      ],
    ])('produces a thin name rather than throwing for %s', (_label, claims) => {
      expect(deriveGoogleName(claims)).toEqual({ firstname: '', lastname: '' });
    });

    // A non-string in one claim must not poison the ones that are usable.
    it('still uses the valid claims when one is malformed', () => {
      expect(
        deriveGoogleName({ given_name: 42, name: 'Ada Lovelace' }),
      ).toEqual({ firstname: 'Ada', lastname: 'Lovelace' });
    });

    it('always returns strings, whatever the claims contain', () => {
      const { firstname, lastname } = deriveGoogleName({ given_name: 42 });

      expect(typeof firstname).toBe('string');
      expect(typeof lastname).toBe('string');
    });
  });
});
