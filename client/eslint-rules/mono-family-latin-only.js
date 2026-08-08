/**
 * `family="mono"` may only be handed digits and `/`.
 *
 * ## Why a lint rule and not a comment
 *
 * `FONT_FAMILIES.mono` is IBM Plex Mono, and it is Latin-only — it has no Thai
 * glyphs at all, so a Thai string in a `mono` node renders in the OEM's own
 * system face, which differs per Android manufacturer and is the entire reason
 * this app bundles a typeface.
 *
 * Worse, and less visible: **`mono`'s `minLineHeightRatio` is 1.03, and that
 * number is only valid for digits and `/`.** `scripts/font-metrics.mjs` scans
 * each family over the code points this app actually hands it, and `mono`'s
 * `scan` range is the blood-pressure vocabulary and nothing else. A floor
 * derived from the glyphs a face is locked to stops covering the moment the
 * face is handed something else — a letter with a descender clips, silently,
 * with no test and no type error. (The alternative was scanning a blanket
 * Latin range, which is what an earlier pass did: `Ů` set `mono`'s floor to
 * 1.55 and inflated the hero figure's line box by 32 %. Widening the scan is
 * not the fix; not widening the content is.)
 *
 * `theme/typography.ts` says all of this in a comment. A comment is not a
 * guard, and this is the guard.
 *
 * ## What it can and cannot see
 *
 * **It is a static rule and it can only read literal children.** All nine
 * `family="mono"` call sites in the app today render `{reading.systolic}` and
 * friends — dynamic expressions, entirely opaque to this rule, and therefore
 * it flags nothing on the current tree. That is the correct outcome, not a
 * sign the rule is inert: what it guards is the *next* edit, where somebody
 * types a unit, a label, or a Thai word into a node that is locked to a face
 * that cannot draw it.
 *
 * Concretely:
 *
 * | written as | seen? |
 * | --- | --- |
 * | `<T family="mono">mmHg</T>` | yes — JSX text |
 * | `` <T family="mono">{`${sys} mmHg`}</T> `` | yes — the literal part of the template |
 * | `<T family="mono">{'ความดัน'}</T>` | yes — a string expression |
 * | `<T family="mono">{reading.systolic}</T>` | **no** — dynamic |
 * | `<T family="mono">{unitLabel}</T>` | **no** — dynamic, even if the constant is a Thai literal three lines up |
 * | `<T family={someId}>…</T>` | **no** — the family itself is dynamic |
 * | `typographyFor(prefs, { family: 'mono' })` | **no** — not a JSX element |
 *
 * A rule that chased the dynamic cases would have to follow identifiers across
 * modules, and the version of it that guesses produces false positives on a
 * config where `--max-warnings 0` makes every false positive a build failure.
 * The honest scope is "a literal that is visibly wrong", and the remaining
 * exposure — a Thai string arriving through a variable — stays a review
 * concern.
 *
 * ## The allowed set
 *
 * Digits, `/`, and whitespace. It is deliberately not "Latin" or "ASCII":
 * `mono`'s floor is measured over digits and `/`, so `mmHg` is as far outside
 * the measurement as `ความดัน` is, even though the glyphs exist. If a real use
 * for another character appears, the fix is to add it to the `scan` range in
 * `scripts/font-metrics.mjs`, re-run it, paste the new ratio, and widen
 * `ALLOWED` here — in that order, and in one change.
 */

/** Digits, the separator, and whitespace. Everything `mono` was measured for. */
const ALLOWED = /^[0-9/\s]*$/u;

/**
 * The offending text, for the message.
 *
 * The literal rather than the set of characters that broke it: a de-duplicated
 * character set turns `mmHg` into `mHg`, which reads like the rule
 * misunderstood the string. What the author needs to see is what they wrote.
 */
function quote(text) {
  const trimmed = text.trim().replace(/\s+/gu, ' ');
  return JSON.stringify(trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed);
}

/** Static text a child node contributes, or `null` if it contributes none we can read. */
function staticTextOf(child) {
  if (child.type === 'JSXText') return child.value;

  if (child.type !== 'JSXExpressionContainer') return null;

  const { expression } = child;

  if (expression.type === 'Literal') {
    return typeof expression.value === 'string' ? expression.value : null;
  }

  // Only the fixed parts. `${systolic}` is dynamic and stays unread — a
  // template is flagged for what it spells out, never for what it interpolates.
  if (expression.type === 'TemplateLiteral') {
    return expression.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ');
  }

  return null;
}

/** Is this `family="mono"` (or `family={'mono'}`)? */
function isMonoFamilyAttribute(attribute) {
  if (attribute.type !== 'JSXAttribute') return false;
  if (attribute.name?.type !== 'JSXIdentifier' || attribute.name.name !== 'family') return false;

  const { value } = attribute;

  if (value?.type === 'Literal') return value.value === 'mono';
  if (value?.type === 'JSXExpressionContainer') {
    return value.expression.type === 'Literal' && value.expression.value === 'mono';
  }

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Only digits and "/" may be written into a family="mono" node — the face is Latin-only and its line-height floor is measured over that vocabulary alone.',
    },
    schema: [],
    messages: {
      nonDigit:
        'family="mono" is Latin-only and its line-height floor is measured over digits and "/" only; {{text}} is outside that set and will clip or fall back to the OEM system face. Drop the `family="mono"`, or move this text to a sibling node.',
    },
  },

  create(context) {
    return {
      JSXElement(node) {
        if (!node.openingElement.attributes.some(isMonoFamilyAttribute)) return;

        for (const child of node.children) {
          const text = staticTextOf(child);
          if (text === null || ALLOWED.test(text)) continue;

          context.report({
            node: child,
            messageId: 'nonDigit',
            data: { text: quote(text) },
          });
        }
      },
    };
  },
};
