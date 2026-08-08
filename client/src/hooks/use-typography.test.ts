/**
 * The resolver: the single multiplication chain, the weight fallback, and the
 * refusal to name a font that is not on the device.
 *
 * These go through `typographyFor` — the pure form — rather than the hook,
 * because every rule under test is about the arithmetic and none of it is
 * about React. What the pure form deliberately does *not* carry is the OS
 * accessibility compensation, which lives in `useFontScale`; that half is
 * pinned by `components/themed-text.test.tsx`, which renders and can therefore
 * see it.
 */
import {
  FONT_FAMILIES,
  FONT_SIZE_STEPS,
  TYPE_SCALE,
} from '@/theme/typography';

import { resolveFamilyWeight, typographyFor, type TextSpec } from './use-typography';

const noto = { fontSize: 'medium', fontFamily: 'noto' } as const;

describe('typographyFor — the multiplication chain', () => {
  it('renders a role at its base size on the medium rung', () => {
    // `default` is 16, the baseline the whole ladder is defined against and
    // the number the setup screen previews.
    expect(typographyFor(noto, { type: 'default' })).toMatchObject({
      fontSize: 16,
      // The table's own 24, untouched. Noto's floor is 1.15 and `default` is
      // 1.5, so the clamp never fires for it.
      lineHeight: TYPE_SCALE.default.lineHeight,
    });
  });

  it('scales size and line height together', () => {
    const style = typographyFor({ ...noto, fontSize: 'xlarge' }, { type: 'body' });

    // 22/16 = 1.375 → 15 × 1.375 ≈ 21, 22 × 1.375 ≈ 30. Both are the plain
    // product; Noto's floor (1.15) is nowhere near.
    expect(style.fontSize).toBe(Math.round(15 * (22 / 16)));
    expect(style.lineHeight).toBe(Math.round(22 * (22 / 16)));
  });

  it('scales an explicit size like a role', () => {
    // The escape hatch has to track the preference, or the blood-pressure
    // figure stops growing while the label under it does.
    expect(typographyFor({ ...noto, fontSize: 'large' }, { size: 48 }).fontSize).toBe(
      Math.round(48 * (19 / 16)),
    );
  });

  it('derives a line height from an explicit size when none is given', () => {
    // `DEFAULT_LINE_HEIGHT_RATIO`, untouched — 1.45 clears Noto's 1.15.
    expect(typographyFor(noto, { size: 20 }).lineHeight).toBe(Math.round(20 * 1.45));
  });

  /*
   * The point of putting both multipliers in one expression. Applied
   * separately they round twice, so a family switch would nudge sizes by a px
   * in whichever direction the caller happened to round first — visible as
   * text that shifts by a hair when the *typeface* changes.
   */
  it('folds the family optical scale into the same rounding step', () => {
    const { opticalScale } = FONT_FAMILIES.sarabun;
    expect(opticalScale).not.toBe(1);

    const style = typographyFor({ fontSize: 'large', fontFamily: 'sarabun' }, { type: 'body' });

    expect(style.fontSize).toBe(Math.round(15 * (19 / 16) * opticalScale));
    expect(style.fontSize).toBe(19);

    // Both numbers round independently, so `body` in Sarabun at the large rung
    // proposes 19/27 — a ratio of 1.42, under what Sarabun's own metrics need.
    // The floor is what lands. This is the case that makes leading a resolver
    // concern rather than something the type scale could have guaranteed.
    expect(Math.round(22 * (19 / 16) * opticalScale)).toBe(27);
    expect(style.lineHeight).toBe(Math.ceil(19 * floorFor('sarabun')));
  });

  it('leaves noto unchanged, being the optical reference', () => {
    // The *size* is the table's, untouched — `opticalScale` is 1 for Noto.
    // The line height is the floor's, which is the one thing the family is
    // allowed to raise.
    expect(typographyFor(noto, { type: 'heading' }).fontSize).toBe(
      TYPE_SCALE.heading.fontSize,
    );
  });

  it('emits every rung of the size ladder as the ladder states it', () => {
    for (const [rung, px] of Object.entries(FONT_SIZE_STEPS)) {
      const style = typographyFor(
        { fontSize: rung as keyof typeof FONT_SIZE_STEPS, fontFamily: 'noto' },
        { type: 'default' },
      );
      expect({ rung, fontSize: style.fontSize }).toEqual({ rung, fontSize: px });
    }
  });

  /*
   * `<TextInput>` only. An explicit line height mis-centres the caret and
   * clips descenders on Android, and the three single-line fields that were
   * doing this arithmetic by hand had no line height for exactly that reason.
   */
  it('omits the line height entirely when asked to', () => {
    const style = typographyFor(noto, { size: 15, lineHeight: null });

    expect(style.fontSize).toBe(15);
    expect('lineHeight' in style).toBe(false);
  });

  it('does not let the clamp resurrect a line height that was suppressed', () => {
    // `null` and the floor are separate branches on purpose. If they ever
    // interact, every `<TextInput>` in the app silently gains a line height
    // and the caret re-centres — the regression `null` was added to prevent.
    for (const rung of ['small', 'medium', 'large', 'xlarge'] as const) {
      for (const family of ['noto', 'looped', 'sarabun', 'mono'] as const) {
        const style = typographyFor({ fontSize: rung, fontFamily: family }, {
          size: 15,
          lineHeight: null,
        });
        expect({ rung, family, has: 'lineHeight' in style }).toEqual({
          rung,
          family,
          has: false,
        });
      }
    }
  });
});

/** The floor this family needs, measured — see `scripts/font-metrics.mjs`. */
const floorFor = (family: keyof typeof FONT_FAMILIES) =>
  FONT_FAMILIES[family].minLineHeightRatio;

/**
 * The floor, and the reason it is in the resolver rather than at the call
 * sites.
 *
 * Android sizes the line box at exactly `lineHeight`, redistributing the
 * font's natural ascent and descent to fit it. Ask for less than the face's
 * own box and the descent is clamped away: Thai below-baseline marks (◌ุ ◌ู,
 * ฐ's foot) lose roughly their bottom half. `tab-buttons.tsx` shipped a
 * `lineHeight={16}` against a 12px `caption` — 1.33 — and clipped on hardware.
 *
 * `theme/typography.test.ts` already asserted this ratio across `TYPE_SCALE`.
 * The hole was that the invariant stopped being enforced the moment a caller
 * passed its own `lineHeight`, which is why a clipping bug shipped green
 * through 2288 tests. These close it at the only layer that sees every spec.
 */
describe('the Thai line-box floor', () => {
  /**
   * Every spec shape a call site in `src/` passes that carries a line height
   * the resolver has to size — the text roles, the `size={n}` escape hatch,
   * and every surviving explicit override.
   *
   * The two large roles (`title`, `heading`) are **not** here, and the
   * exclusion is the design: see `TEXT_ROLES` below and the note on
   * `clampLineHeight`.
   *
   * Four roles left this list with §3's consolidation — `small`, `smallBold`,
   * `link`, and `display`. They are not gaps in the coverage: `small` and
   * `smallBold` folded into `body` (and `body` + `weight="bold"`, which the
   * `flatMap` below already generates), `link` had no call sites, and
   * `display` was the blood-pressure figure, now covered by `size: 38`.
   */
  const TEXT_ROLES = [
    'bodyLarge',
    'default',
    'body',
    'label',
    'caption',
    'code',
  ] as const;

  const CALL_SITES: TextSpec[] = [
    // Text roles, with and without a weight override.
    ...TEXT_ROLES.flatMap((type) => [{ type }, { type, weight: 'bold' as const }]),
    // The `size={n}` escape hatch, at every value the app uses. These derive
    // their leading from `DEFAULT_LINE_HEIGHT_RATIO`, which is the floor.
    // 18, 19, and 36 left the app with §3: the heading sizes folded into
    // `type="heading"` and the detail screen's slash joined its digits at 38.
    // They stay here anyway — the floor has to hold for a size the app takes
    // up again, and the cost of an extra spec in this list is nothing.
    ...[11, 14, 15, 16, 17, 18, 19, 22, 26, 28, 36, 38, 48].map((size) => ({ size })),
    // Explicit line-height overrides that survive: the two composers and the
    // post card's measured body.
    { size: 16, lineHeight: 24 },
    { size: 15, lineHeight: 23 },
    { size: 15, lineHeight: 15 + 8 },
    // The `mono` override on the blood-pressure figure.
    { size: 48, weight: 'bold' as const, family: 'mono' as const },
    { size: 38, weight: 'bold' as const, family: 'mono' as const },
    // The old `tab-buttons` shape, which is what clipped. Kept as a case so a
    // caller reintroducing it fails here rather than on someone's phone.
    { type: 'caption' as const, lineHeight: 16 },
    // The old `font-size-picker` shape — 22/16, below the floor and invisible
    // only because its sample text is the Latin `Aa`.
    { size: 16, lineHeight: 22, weight: 'bold' as const },
  ];

  it('never emits a ratio below the minimum, for any spec, rung, or family', () => {
    for (const spec of CALL_SITES) {
      for (const rung of Object.keys(FONT_SIZE_STEPS) as (keyof typeof FONT_SIZE_STEPS)[]) {
        for (const family of Object.keys(FONT_FAMILIES) as (keyof typeof FONT_FAMILIES)[]) {
          const style = typographyFor({ fontSize: rung, fontFamily: family }, spec);
          const ratio = (style.lineHeight as number) / (style.fontSize as number);
          // A `family` on the spec overrides the preference — the BP figure
          // pins itself to `mono` — so the floor that applies is the one the
          // node actually renders in, not the one the user picked.
          const effective = spec.family ?? family;

          expect({
            spec,
            rung,
            family,
            ok: ratio >= floorFor(effective),
          }).toEqual({ spec, rung, family, ok: true });
        }
      }
    }
  });

  /*
   * The exact case confirmed on hardware. `caption` is 12; the old override
   * asked for 16 (1.33) and got it. It now reads the role's own 18.
   *
   * Worth knowing which family is worst: because both numbers round
   * independently, at the medium rung Noto and looped both emit 12/16 = 1.33
   * unclamped (looped's 1.02 rounds both back down) while Sarabun emits
   * 12/17 = 1.42. **Looped is the worst case, not Sarabun** — the intuition
   * that the largest optical scale is the most at risk is backwards.
   */
  /*
   * The `tab-buttons.tsx` override that clipped on hardware — `lineHeight={16}`
   * against a 12px `caption`, 1.33.
   *
   * Asserted in Sarabun, because that is where it clipped. In Noto the same
   * spec is left alone: Noto's floor is 1.15 and 1.33 clears it, which is the
   * measurement agreeing with the device report that Noto was fine.
   */
  it('raises a caller override only where the face needs it', () => {
    const sarabun = typographyFor(
      { fontSize: 'medium', fontFamily: 'sarabun' },
      { type: 'caption', lineHeight: 16 },
    );
    expect(sarabun.lineHeight).toBe(Math.ceil(sarabun.fontSize! * floorFor('sarabun')));

    const inNoto = typographyFor(noto, { type: 'caption', lineHeight: 16 });
    expect(inNoto.fontSize).toBe(12);
    expect(inNoto.lineHeight).toBe(16);
  });

  /*
   * The floor is a property of the font, not of the language. Sarabun needs
   * more than Noto because it *declares* less: a 0.232 em descent against a
   * 0.353 em vowel. Asserting they differ is what stops someone collapsing
   * this back into one constant.
   */
  it('asks each family for what that family measured', () => {
    const ratios = (['noto', 'looped', 'sarabun'] as const).map(floorFor);

    expect(new Set(ratios).size).toBeGreaterThan(1);
    expect(floorFor('sarabun')).toBeGreaterThan(floorFor('noto'));
    expect(floorFor('looped')).toBeGreaterThan(floorFor('noto'));
  });

  /*
   * The regression the device pass found, and the reason the large roles are
   * no longer exempt from the floor.
   *
   * `heading` is 20/28 = 1.40. It used to be waved through on the reasoning
   * that the ratio is a proxy for *absolute* descent room and large sizes have
   * plenty of it. That reasoning is wrong: font metrics are per-em, so the
   * requirement is scale-invariant and a ratio is exactly the right unit.
   *
   * The profile screen's name is a `heading`. In Sarabun it was emitting
   * 21/29 — 1.38 against a face that needs 1.55 — and lost most of its
   * below-baseline vowels on a real phone.
   */
  it('raises the large roles that sit under a family’s floor', () => {
    for (const role of ['title', 'heading'] as const) {
      for (const family of ['noto', 'looped', 'sarabun'] as const) {
        const style = typographyFor({ fontSize: 'medium', fontFamily: family }, { type: role });
        const ratio = (style.lineHeight as number) / (style.fontSize as number);

        expect({ role, family, ok: ratio >= floorFor(family) }).toEqual({
          role,
          family,
          ok: true,
        });
      }
    }
  });

  /*
   * The specific surface, pinned by name. `heading` in Sarabun is what the
   * user saw clipped.
   */
  it('gives a Sarabun heading the leading Sarabun needs', () => {
    const style = typographyFor({ fontSize: 'medium', fontFamily: 'sarabun' }, { type: 'heading' });

    // 20 × 1.04 → 21; the floor is what decides the line height, not the 28
    // in the table.
    expect(style.fontSize).toBe(21);
    expect(style.lineHeight).toBe(Math.ceil(21 * floorFor('sarabun')));
    expect(style.lineHeight).toBeGreaterThan(Math.round(28 * 1.04));
  });

  /*
   * Noto must not move. It never had the bug — it declares a 0.450 em descent
   * against a 0.265 em deepest mark — so a floor that shifted the default
   * family's body text would be the fix causing a regression of its own.
   */
  /*
   * The acceptance criterion for the whole mechanism, stated as a test.
   *
   * Noto's declared metrics are honest — a 0.450 em descent against a 0.265 em
   * deepest mark — so it requires 1.15 and every role in the table clears it.
   * **The clamp must therefore be invisible on the default family.** A floor
   * that moved Noto would be a leading redesign wearing a bug fix's clothes,
   * which is what the first version of this was.
   */
  it('changes nothing at all for a Noto user', () => {
    for (const rung of Object.keys(FONT_SIZE_STEPS) as (keyof typeof FONT_SIZE_STEPS)[]) {
      const scale = FONT_SIZE_STEPS[rung] / 16;

      for (const role of Object.keys(TYPE_SCALE) as (keyof typeof TYPE_SCALE)[]) {
        const style = typographyFor({ fontSize: rung, fontFamily: 'noto' }, { type: role });

        expect({ rung, role, lineHeight: style.lineHeight }).toEqual({
          rung,
          role,
          // The plain product — what the app emitted before any of this.
          lineHeight: Math.round(TYPE_SCALE[role].lineHeight * scale),
        });
      }
    }
  });

  /*
   * And the same for the blood-pressure figure, which is `mono`. Its floor is
   * measured over digits and `/` — the only glyphs it is handed. An earlier
   * pass scanned accented Latin, got 1.55 from `Ů`, and inflated the hero
   * figure's line box by 32%.
   *
   * **Two sizes, not three.** §3(b): 48 on the home hero card, 38 on the
   * reading-detail screen and in a history row. The detail screen used to be
   * `type="display"` (44) with a `size={36}` slash — a pair nobody chose, and
   * a pair that had to be kept in step by hand because the two numbers reached
   * the resolver by different routes (a role's own `lineHeight` versus
   * `size × DEFAULT_LINE_HEIGHT_RATIO`).
   */
  it('changes nothing for the blood-pressure figure either', () => {
    for (const size of [38, 48] as const) {
      const style = typographyFor(noto, { size, weight: 'bold', family: 'mono' });
      const scale = FONT_FAMILIES.mono.opticalScale;

      expect({ size, lineHeight: style.lineHeight }).toEqual({
        size,
        lineHeight: Math.round(size * 1.45 * scale),
      });
    }
  });

  /*
   * The `flex-row items-end` invariant, now structural.
   *
   * All three blood-pressure surfaces render the slash at the digits' own
   * size, so "the line boxes match" is true by construction rather than by two
   * numbers agreeing. Asserted at every font-size rung and in every family a
   * user can hold, because the figure is `mono` for everyone and the rounding
   * happens after the preference is applied.
   */
  it('keeps the slash and the digits on one line box, on every surface', () => {
    for (const fontSize of ['small', 'medium', 'large', 'xlarge'] as const) {
      for (const size of [38, 48] as const) {
        const spec = { size, weight: 'bold' as const, family: 'mono' as const };
        const digits = typographyFor({ fontSize, fontFamily: 'noto' }, spec);
        const slash = typographyFor({ fontSize, fontFamily: 'sarabun' }, spec);

        expect({ fontSize, size, lineHeight: slash.lineHeight, fontSize2: slash.fontSize }).toEqual({
          fontSize,
          size,
          lineHeight: digits.lineHeight,
          fontSize2: digits.fontSize,
        });
      }
    }
  });

  it('leaves a caller that asks for more leading alone', () => {
    // A floor, not a fixed value. Tightening is refused; loosening is a
    // legitimate design choice and must still work.
    const roomy = typographyFor(noto, { size: 16, lineHeight: 32 });

    expect(roomy.lineHeight).toBe(32);
  });

  it('does not warn when a role simply needs more leading in this family', () => {
    // Routine, not a defect: the type scale is family-agnostic by design and
    // adapting it is the clamp's job. Warning here would fire on nearly every
    // node in the app the moment a user picks a non-default face.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    typographyFor({ fontSize: 'medium', fontFamily: 'sarabun' }, { type: 'heading' });
    typographyFor({ fontSize: 'medium', fontFamily: 'looped' }, { type: 'body' });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns in dev, naming the spec it overruled', () => {
    // A clamp that silently overrides its caller is the same species of
    // silence this resolver exists to remove. The next author has to learn
    // their `lineHeight={16}` did not mean 16 when they write it.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // In Sarabun: 16-over-12 is 1.33, under `DEFAULT_LINE_HEIGHT_RATIO`, and
    // Sarabun is a face where that actually clips. Noto would not clamp this
    // at all, so it could not warn about it either.
    typographyFor({ fontSize: 'medium', fontFamily: 'sarabun' }, { type: 'caption', lineHeight: 16 });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('lineHeight');
    expect(warn.mock.calls[0][0]).toContain('caption');

    warn.mockRestore();
  });

  it('stays quiet when nothing was overruled', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    typographyFor(noto, { type: 'body' });
    typographyFor(noto, { size: 15, lineHeight: null });
    typographyFor(noto, { size: 16, lineHeight: 32 });

    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  /*
   * On Android a `fontWeight` beside an explicit `fontFamily` is ignored or
   * synthesised into a fake bold. Weight selects a *file*. Emitting one would
   * also invite a caller to believe `className="font-bold"` works.
   */
  it('never emits a fontWeight', () => {
    for (const role of Object.keys(TYPE_SCALE) as (keyof typeof TYPE_SCALE)[]) {
      expect(typographyFor(noto, { type: role }).fontWeight).toBeUndefined();
    }
  });
});

describe('family selection', () => {
  it('follows the preference when the spec names none', () => {
    expect(typographyFor({ fontSize: 'medium', fontFamily: 'sarabun' }).fontFamily).toBe(
      'Sarabun_400Regular',
    );
  });

  /*
   * The one standing override in the app. The blood-pressure figure is a
   * number to compare down a column, and proportional digits make that column
   * jitter — so it is pinned to a tabular face rather than to a preference
   * that was never about numerals.
   */
  it('lets an explicit family override the preference', () => {
    const style = typographyFor(
      { fontSize: 'medium', fontFamily: 'sarabun' },
      { size: 48, weight: 'bold', family: 'mono' },
    );

    expect(style.fontFamily).toBe('IBMPlexMono_700Bold');
    // And it takes mono's optical scale with it, not Sarabun's.
    expect(style.fontSize).toBe(Math.round(48 * FONT_FAMILIES.mono.opticalScale));
  });

  /*
   * The failure this whole mechanism exists to prevent, and it is silent: an
   * unregistered `fontFamily` does not throw, it drops to the OEM's own Thai
   * face — a different typeface per Android manufacturer. The families outside
   * `noto` load *after* first paint, so this is a normal runtime state rather
   * than a coding mistake.
   */
  describe('when the family has not finished loading', () => {
    const onlyNoto = new Set(['noto'] as const);

    it('falls back to noto rather than naming an unloaded font', () => {
      const style = typographyFor(
        { fontSize: 'medium', fontFamily: 'looped' },
        { type: 'body' },
        onlyNoto,
      );

      expect(style.fontFamily).toBe('NotoSansThai_500Medium');
    });

    it('falls back for an explicit family override too', () => {
      expect(
        typographyFor(noto, { size: 48, weight: 'bold', family: 'mono' }, onlyNoto).fontFamily,
      ).toBe('NotoSansThai_700Bold');
    });

    it('uses the fallback family’s optical scale, not the requested one', () => {
      // Otherwise the text would be sized for a face it is not rendering in,
      // and would visibly resize when the real font landed.
      expect(
        typographyFor({ fontSize: 'medium', fontFamily: 'sarabun' }, { type: 'body' }, onlyNoto)
          .fontSize,
      ).toBe(TYPE_SCALE.body.fontSize);
    });

    it('serves the real family once it has landed', () => {
      const loaded = new Set(['noto', 'sarabun'] as const);

      expect(
        typographyFor({ fontSize: 'medium', fontFamily: 'sarabun' }, { type: 'body' }, loaded)
          .fontFamily,
      ).toBe('Sarabun_400Regular');
    });
  });
});

/*
 * Only `noto` ships four weights — the other three carry regular + bold to
 * keep the bundle down. `medium` and `semibold` therefore have to land
 * somewhere, and they fall outward rather than both collapsing onto regular:
 * those two rungs are what separates a card's title from its subtitle, and
 * collapsing them would flatten that hierarchy on every settings-shaped screen.
 */
describe('resolveFamilyWeight', () => {
  it('keeps all four distinct on a four-weight family', () => {
    expect(resolveFamilyWeight('noto', 'regular')).toBe('NotoSansThai_400Regular');
    expect(resolveFamilyWeight('noto', 'medium')).toBe('NotoSansThai_500Medium');
    expect(resolveFamilyWeight('noto', 'semibold')).toBe('NotoSansThai_600SemiBold');
    expect(resolveFamilyWeight('noto', 'bold')).toBe('NotoSansThai_700Bold');
  });

  it('maps medium down to regular and semibold up to bold', () => {
    for (const id of ['looped', 'sarabun', 'mono'] as const) {
      const { regular, bold } = FONT_FAMILIES[id].weights;

      expect(resolveFamilyWeight(id, 'regular')).toBe(regular);
      expect(resolveFamilyWeight(id, 'medium')).toBe(regular);
      expect(resolveFamilyWeight(id, 'semibold')).toBe(bold);
      expect(resolveFamilyWeight(id, 'bold')).toBe(bold);
    }
  });

  it('keeps two visibly different faces rather than one', () => {
    // The property that matters more than the exact mapping: a title and its
    // subtitle must not resolve to the same file.
    for (const id of ['looped', 'sarabun'] as const) {
      expect(resolveFamilyWeight(id, 'medium')).not.toBe(resolveFamilyWeight(id, 'semibold'));
    }
  });

  it('never returns an empty name for any family and weight', () => {
    // An empty `fontFamily` is the silent OEM fallback again, arrived at from
    // the other direction — a family whose registry entry lost a weight.
    for (const id of Object.keys(FONT_FAMILIES) as (keyof typeof FONT_FAMILIES)[]) {
      for (const weight of ['regular', 'medium', 'semibold', 'bold'] as const) {
        expect({ id, weight, name: resolveFamilyWeight(id, weight) }).not.toEqual({
          id,
          weight,
          name: '',
        });
      }
    }
  });
});
