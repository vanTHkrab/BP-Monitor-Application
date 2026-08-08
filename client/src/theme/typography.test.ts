/**
 * The family registry, pinned against what the app actually loads.
 *
 * This is the same guard `themed-text.test.tsx` already applies to
 * `ThaiFontFamily`'s four weights, widened to four families — and it matters
 * more now, not less. A name that was never registered **does not throw**: RN
 * silently falls back to the OEM's own Thai face, which is a different
 * typeface per Android manufacturer and the whole reason this app bundles one.
 * There is no runtime signal, no red screen, and no failing render. A list
 * assertion is the only thing that catches it.
 *
 * The loaded set below is written out by hand rather than imported from
 * `app/_layout.tsx`, deliberately: importing the layout would drag the whole
 * provider tree into a unit test, and a test that derived its expectation from
 * the same expression as the code would assert nothing. Two lists that must be
 * kept in step by a human are exactly what this is for.
 */
import {
  FONT_FAMILIES,
  SELECTABLE_FONT_FAMILIES,
  TYPE_SCALE,
  isFontFamily,
  isSelectableFontFamily,
} from './typography';

/**
 * Every font `app/_layout.tsx` registers, split the way that file splits them.
 *
 * **What blocks is what every user sees whether they chose it or not.** Noto
 * is the default face; IBM Plex Mono is pinned to the blood-pressure figure by
 * `family="mono"` on the home hero card, every history row, and the detail
 * screen. Deferring mono made those digits change typeface *and* size
 * mid-launch on every cold start — `opticalScale` is 0.96, so `size={48}`
 * emitted 48 before the swap and 46 after, racing the readings query on the
 * app's primary screen.
 *
 * Only `looped` and `sarabun` are deferred, and both are families a user has
 * to actively pick.
 */
const BLOCKING = new Set([
  'NotoSansThai_400Regular',
  'NotoSansThai_500Medium',
  'NotoSansThai_600SemiBold',
  'NotoSansThai_700Bold',
  'IBMPlexMono_400Regular',
  'IBMPlexMono_700Bold',
]);

const DEFERRED = new Set([
  'NotoSansThaiLooped_400Regular',
  'NotoSansThaiLooped_700Bold',
  'Sarabun_400Regular',
  'Sarabun_700Bold',
]);

const LOADED = new Set([...BLOCKING, ...DEFERRED]);

describe('FONT_FAMILIES', () => {
  it('only names font files the app loads', () => {
    for (const [id, family] of Object.entries(FONT_FAMILIES)) {
      for (const [weight, name] of Object.entries(family.weights)) {
        expect({ id, weight, name, loaded: LOADED.has(name) }).toEqual({
          id,
          weight,
          name,
          loaded: true,
        });
      }
    }
  });

  it('loads nothing it cannot name', () => {
    // The other direction: a font added to `_layout.tsx` and never wired into
    // the registry is dead weight in the bundle, which on a phone is paid for
    // at install time by every user.
    const named = new Set(
      Object.values(FONT_FAMILIES).flatMap((family) => Object.values(family.weights)),
    );

    expect([...LOADED].filter((name) => !named.has(name))).toEqual([]);
  });

  /*
   * `noto` is the fallback every other family degrades to — see
   * `use-typography.ts` — so it is the one family that must be complete. If a
   * weight were missing here, the fallback itself would fall back.
   */
  it('gives noto all four weights and everything else regular plus bold', () => {
    expect(Object.keys(FONT_FAMILIES.noto.weights).sort()).toEqual([
      'bold',
      'medium',
      'regular',
      'semibold',
    ]);

    for (const id of ['looped', 'sarabun', 'mono'] as const) {
      expect(Object.keys(FONT_FAMILIES[id].weights).sort()).toEqual(['bold', 'regular']);
    }
  });

  /*
   * The rule that came out of the mono regression: **a family nobody opts
   * into must not be deferred.** `mono` is not a preference — it is locked
   * onto the blood-pressure figure for every user — so loading it late meant
   * the hero digits swapped typeface and size after first paint on every cold
   * start. Anything internal (`thai: 'latin-only'`) is by definition not
   * opted into, which makes this assertable rather than a comment.
   */
  it('blocks every family a user cannot opt out of', () => {
    for (const [id, family] of Object.entries(FONT_FAMILIES)) {
      if (family.thai === 'full' && id !== 'noto') continue;

      for (const name of Object.values(family.weights)) {
        expect({ id, name, blocking: BLOCKING.has(name) }).toEqual({
          id,
          name,
          blocking: true,
        });
      }
    }
  });

  it('defers only families the picker offers', () => {
    const deferredIds = Object.entries(FONT_FAMILIES)
      .filter(([, family]) => Object.values(family.weights).some((n) => DEFERRED.has(n)))
      .map(([id]) => id);

    for (const id of deferredIds) {
      expect({ id, selectable: SELECTABLE_FONT_FAMILIES.includes(id as never) }).toEqual({
        id,
        selectable: true,
      });
    }
  });

  /*
   * The numbers `scripts/font-metrics.mjs` reads out of the font binaries.
   * Restated here as literals on purpose: this is the one place a silent edit
   * would reintroduce clipped Thai on a device nobody is holding, and a test
   * that derived them from the same source it is checking would assert
   * nothing. If the script's output changes, change both — and say why.
   *
   * They are *clipping minimums* and nothing more. An earlier pass added the
   * font's own declared box as a third term, which put `noto` at 1.52 and
   * loosened every heading in the default family as a side effect of a bug
   * fix. `noto` at 1.15 is what the span actually requires; see the note on
   * `minLineHeightRatio`.
   */
  it('carries the measured line-height floors', () => {
    expect({
      noto: FONT_FAMILIES.noto.minLineHeightRatio,
      looped: FONT_FAMILIES.looped.minLineHeightRatio,
      sarabun: FONT_FAMILIES.sarabun.minLineHeightRatio,
      mono: FONT_FAMILIES.mono.minLineHeightRatio,
    }).toEqual({ noto: 1.15, looped: 1.55, sarabun: 1.55, mono: 1.03 });
  });

  it('carries the measured natural boxes', () => {
    // Only a fixed-height container reads these — the tab bar. looped and
    // Sarabun are 15% and 23% taller than Noto here, which is what overflowed
    // a bar sized when Noto was the only face.
    expect({
      noto: FONT_FAMILIES.noto.naturalLineHeightRatio,
      looped: FONT_FAMILIES.looped.naturalLineHeightRatio,
      sarabun: FONT_FAMILIES.sarabun.naturalLineHeightRatio,
      mono: FONT_FAMILIES.mono.naturalLineHeightRatio,
    }).toEqual({ noto: 1.52, looped: 1.74, sarabun: 1.86, mono: 1.3 });
  });

  /*
   * The shape of the finding, not the numbers: a face can need *more* line
   * height than Noto, and the two families that do are exactly the two the
   * device pass caught. A flat floor cannot express this, which is why the
   * first attempt at it failed on hardware while passing every test.
   */
  it('gives every family a floor of its own', () => {
    for (const [id, family] of Object.entries(FONT_FAMILIES)) {
      expect({ id, ok: family.minLineHeightRatio > 1 }).toEqual({ id, ok: true });
      expect({ id, ok: family.naturalLineHeightRatio > 1 }).toEqual({ id, ok: true });
    }

    expect(FONT_FAMILIES.sarabun.minLineHeightRatio).toBeGreaterThan(
      FONT_FAMILIES.noto.minLineHeightRatio,
    );
    expect(FONT_FAMILIES.looped.naturalLineHeightRatio).toBeGreaterThan(
      FONT_FAMILIES.noto.naturalLineHeightRatio,
    );
  });

  /*
   * The acceptance criterion for the whole line-height mechanism: **a Noto
   * user sees no pixel change from it.** Every role in the table has to clear
   * Noto's floor on its own, so the clamp never fires for the default family.
   * If this fails, the floor has stopped being a clipping minimum and has
   * started being a leading opinion.
   */
  it('never fires for any role in the default family', () => {
    for (const [role, spec] of Object.entries(TYPE_SCALE)) {
      expect({
        role,
        clears: spec.lineHeight / spec.fontSize >= FONT_FAMILIES.noto.minLineHeightRatio,
      }).toEqual({ role, clears: true });
    }
  });

  it('leaves noto as the optical reference at exactly 1', () => {
    // Every other `opticalScale` is relative to this one. A drift here shifts
    // the whole app rather than one family.
    expect(FONT_FAMILIES.noto.opticalScale).toBe(1);
  });
});

describe('SELECTABLE_FONT_FAMILIES', () => {
  /*
   * `mono` is Latin-only. Offering it as the app-wide typeface would drop
   * every Thai string in the product to the OEM system font — a setting whose
   * failure mode is "the app is now in a typeface I did not choose and cannot
   * name". The filter is on `thai`, not on a list, so this holds for a family
   * added later too.
   */
  it('excludes every latin-only family', () => {
    expect(SELECTABLE_FONT_FAMILIES).not.toContain('mono');

    for (const id of SELECTABLE_FONT_FAMILIES) {
      expect(FONT_FAMILIES[id].thai).toBe('full');
    }
  });

  it('offers every Thai-capable family', () => {
    const thaiCapable = Object.entries(FONT_FAMILIES)
      .filter(([, family]) => family.thai === 'full')
      .map(([id]) => id);

    expect([...SELECTABLE_FONT_FAMILIES].sort()).toEqual(thaiCapable.sort());
  });

  it('gives every offered family user-facing Thai copy', () => {
    // The picker renders both. An empty string would render as a blank card.
    for (const id of SELECTABLE_FONT_FAMILIES) {
      expect(FONT_FAMILIES[id].label.length).toBeGreaterThan(0);
      expect(FONT_FAMILIES[id].description.length).toBeGreaterThan(0);
    }
  });
});

describe('isSelectableFontFamily', () => {
  /*
   * Stricter than `isFontFamily` on purpose, and it is what the store
   * hydrates against. `mono` is a real family and a legitimate per-node
   * override, but as an *app-wide* preference it drops every Thai string to
   * the OEM face.
   */
  it('rejects a latin-only family that isFontFamily accepts', () => {
    expect(isFontFamily('mono')).toBe(true);
    expect(isSelectableFontFamily('mono')).toBe(false);
  });

  it('accepts exactly what the picker offers', () => {
    for (const id of SELECTABLE_FONT_FAMILIES) {
      expect(isSelectableFontFamily(id)).toBe(true);
    }
  });

  it('rejects the same junk isFontFamily does', () => {
    for (const junk of ['comic-sans', 'toString', null, undefined, 1]) {
      expect(isSelectableFontFamily(junk)).toBe(false);
    }
  });
});

describe('isFontFamily', () => {
  it('accepts what the registry knows and rejects everything else', () => {
    expect(isFontFamily('noto')).toBe(true);
    expect(isFontFamily('mono')).toBe(true);
    // The shapes AsyncStorage can hand back for a key written by an older or
    // newer build. Each has to read as "use the default", not as a family.
    expect(isFontFamily('comic-sans')).toBe(false);
    expect(isFontFamily(null)).toBe(false);
    expect(isFontFamily(undefined)).toBe(false);
    expect(isFontFamily(1)).toBe(false);
    // Prototype keys are `in` an object literal's chain; the guard must not
    // treat one as a family and then name `toString` as a font.
    expect(isFontFamily('toString')).toBe(false);
  });
});

/*
 * The role table arrived from `themed-text.tsx` verbatim and was a pile of
 * accidents rather than a scale — `docs/project/CLIENT-typography.md` §3. That
 * decision is now closed, and the answer was subtraction: `small`, `smallBold`,
 * `link`, and `display` are gone. These are the numbers as they now are, pinned
 * so the *next* accident — a role added one at a time, which is how the first
 * twelve came to exist — fails here rather than shipping.
 */
describe('TYPE_SCALE', () => {
  it('carries the eight roles §3 left standing', () => {
    expect(TYPE_SCALE).toEqual({
      title: { fontSize: 24, lineHeight: 32, weight: 'bold' },
      heading: { fontSize: 20, lineHeight: 28, weight: 'semibold' },
      bodyLarge: { fontSize: 17, lineHeight: 25, weight: 'medium' },
      default: { fontSize: 16, lineHeight: 24, weight: 'medium' },
      body: { fontSize: 15, lineHeight: 22, weight: 'medium' },
      label: { fontSize: 13, lineHeight: 19, weight: 'semibold' },
      caption: { fontSize: 12, lineHeight: 18, weight: 'regular' },
      code: { fontSize: 12, lineHeight: 18, weight: 'bold' },
    });
  });

  /*
   * §3(c)'s actual finding, asserted rather than described: `label` 13 /
   * `small` 14 / `body` 15 were 190-odd nodes one pixel apart, and at the
   * `small` font-size rung they rounded to 11 / 12 / 12 — the hierarchy
   * stopped existing exactly where legibility mattered most. The band is now
   * 13 / 15 / 17, so each rung clears the one below it by ~13 % and survives
   * rounding at every rung of the size preference.
   *
   * This is the guard against re-answering §3 by adding a variant one at a
   * time, which is how the twelve roles came to exist in the first place.
   */
  it('keeps at least two px between the rungs of the text band', () => {
    const band = ['label', 'body', 'bodyLarge'] as const;

    for (let i = 1; i < band.length; i += 1) {
      const lower = TYPE_SCALE[band[i - 1]].fontSize;
      const upper = TYPE_SCALE[band[i]].fontSize;

      expect({ pair: `${band[i - 1]}→${band[i]}`, gap: upper - lower }).toEqual({
        pair: `${band[i - 1]}→${band[i]}`,
        gap: 2,
      });
    }
  });

  /*
   * The roles §3 removed, named so a re-add is a deliberate act.
   *
   * - `small` / `smallBold` (14) folded into `body` (15) and `body` +
   *   `weight="bold"`.
   * - `link` (14) had no call sites and named a rung that no longer exists.
   * - `display` (44) was only ever the reading-detail screen's blood-pressure
   *   figure, which is one component's composition and belongs in `size` —
   *   `themed-text.tsx` documents the figure as exactly that. Naming it a role
   *   is what let the detail screen drift to a third size nobody chose.
   */
  it('does not carry the four roles §3 removed', () => {
    for (const gone of ['small', 'smallBold', 'link', 'display']) {
      expect({ role: gone, present: gone in TYPE_SCALE }).toEqual({
        role: gone,
        present: false,
      });
    }
  });

  /*
   * Thai stacks สระบน plus วรรณยุกต์ two levels deep, so the ratio that reads
   * as generous in Latin is merely adequate here. The text roles sit at
   * ~1.45–1.5×; the two large roles (`title`, `heading`) are deliberately
   * tighter, because at 20px and up the absolute leading is already ample and
   * 1.45 would leave a heading floating in its own block.
   *
   * §3's consolidation removed rungs and moved no surviving role's `fontSize`,
   * so every `lineHeight` below is still the one chosen against its own size.
   * That is why this test did not need new numbers — but it is exactly the
   * test that catches a future size change shipped with a stale line height,
   * which is the defect class that produced the Thai vowel clipping.
   *
   * §5's device pass is what confirms either band is actually enough — and it
   * now has to confirm it **per family**, since the numbers were tuned against
   * Noto alone.
   */
  it('keeps the text roles at a Thai-safe leading ratio', () => {
    const textRoles = ['bodyLarge', 'default', 'body', 'label', 'caption', 'code'] as const;

    for (const role of textRoles) {
      const { fontSize, lineHeight } = TYPE_SCALE[role];
      expect({ role, ok: lineHeight / fontSize >= 1.45 }).toEqual({ role, ok: true });
    }
  });
});
