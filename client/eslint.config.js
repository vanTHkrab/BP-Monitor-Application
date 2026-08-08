// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const monoFamilyLatinOnly = require('./eslint-rules/mono-family-latin-only');

/**
 * Rules this project owns, for traps whose failure mode is invisible in
 * review. They live in `eslint-rules/` as plain CommonJS so this file can
 * require them without a build step; each carries its reasoning and its
 * limitations in its own header.
 */
const bp = {
  rules: {
    'mono-family-latin-only': monoFamilyLatinOnly,
  },
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'android/*', 'ios/*', 'coverage/*'],
  },
  {
    /**
     * `family="mono"` is the blood-pressure figure's tabular face. It is
     * Latin-only, and its line-height floor (1.03) is measured over digits and
     * `/` alone — see `scripts/font-metrics.mjs`. Putting a letter in one of
     * those nodes silently stops the floor covering the content, with no test
     * and no type error to catch it.
     *
     * `error`, not `warn`, and the distinction is cosmetic here: `pnpm lint`
     * runs with `--max-warnings 0`, so a warning fails the build like an error
     * and only reads as less serious than it is.
     */
    files: ['src/**/*.tsx'],
    plugins: { bp },
    rules: {
      'bp/mono-family-latin-only': 'error',
    },
  },
  {
    /**
     * `tamagui.config.ts` exports its config both as the default and as a
     * named `tamaguiConfig`, which is the shape Tamagui's own docs use. The
     * rule reads the matching name on the default import as a mistake; here
     * it is the intended one, and there is nothing to rename.
     */
    rules: {
      'import/no-named-as-default': 'off',
    },
  },
  {
    /**
     * Jest hoists `jest.mock(...)` above every import in the file, so a mock
     * that has to be installed before the module under test is imported must
     * be written above those imports — `import/first` reads the resulting
     * order as a defect. And a `jest.mock` factory cannot close over an
     * imported binding (the hoisting is why), so `require()` inside it is the
     * only way to reach the replacement module.
     *
     * Scoped to test files: both rules stay on everywhere else, where the
     * patterns really would be defects.
     */
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', '**/__test__/**'],
    rules: {
      'import/first': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
