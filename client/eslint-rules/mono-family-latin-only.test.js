/**
 * The `mono` content rule, and the line between what it can and cannot see.
 *
 * Half of these cases are `valid` because the rule is *blind* to them, not
 * because they are safe — `{unitLabel}` holding a Thai string is a real defect
 * this rule will never report. Asserting them as valid is how that limitation
 * stays a stated property of the rule instead of a surprise the first time
 * someone hits it and assumes the guard has their back.
 *
 * `RuleTester` runs on espree with JSX enabled rather than on the TypeScript
 * parser the project actually lints with. The rule only ever touches
 * `JSXElement` / `JSXAttribute` / `TemplateLiteral` nodes, which both parsers
 * produce identically; using espree keeps this test free of a parser
 * dependency it would otherwise pin a version of.
 */
const { RuleTester } = require('eslint');

const rule = require('./mono-family-latin-only');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('mono-family-latin-only', rule, {
  valid: [
    // The shape every real call site in the app has today.
    '<ThemedText size={48} family="mono">{reading.systolic}</ThemedText>',
    // The one literal `mono` node that exists, and the reason `/` is allowed.
    '<ThemedText size={48} family="mono">/</ThemedText>',
    '<ThemedText family="mono">120/80</ThemedText>',
    '<ThemedText family="mono">{`${sys}/${dia}`}</ThemedText>',
    // Not a `mono` node at all.
    '<ThemedText>ความดันโลหิต</ThemedText>',
    '<ThemedText family="noto">mmHg</ThemedText>',

    /*
     * Blind spots, asserted as such. Each of these is a genuine defect the
     * rule cannot reach; see the file header for why chasing them produces
     * false positives on a `--max-warnings 0` config.
     */
    '<ThemedText family="mono">{unitLabel}</ThemedText>',
    '<ThemedText family={familyId}>ความดัน</ThemedText>',
    "<ThemedText family={cond ? 'mono' : 'noto'}>mmHg</ThemedText>",
  ],
  invalid: [
    {
      code: '<ThemedText family="mono">mmHg</ThemedText>',
      errors: [{ messageId: 'nonDigit' }],
    },
    {
      code: '<ThemedText size={38} weight="bold" family="mono">ความดัน</ThemedText>',
      errors: [{ messageId: 'nonDigit' }],
    },
    // The literal half of a template is read; the interpolation is not.
    {
      code: '<ThemedText family="mono">{`${sys} mmHg`}</ThemedText>',
      errors: [{ messageId: 'nonDigit' }],
    },
    {
      code: "<ThemedText family={'mono'}>{'ความดัน'}</ThemedText>",
      errors: [{ messageId: 'nonDigit' }],
    },
    // Two offending children, two reports — the node in the message is the
    // child, so a mixed element points at the part that is wrong.
    {
      code: '<ThemedText family="mono">120/80{" mmHg"}</ThemedText>',
      errors: [{ messageId: 'nonDigit' }],
    },
  ],
});
