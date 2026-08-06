// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'android/*', 'ios/*', 'coverage/*'],
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
