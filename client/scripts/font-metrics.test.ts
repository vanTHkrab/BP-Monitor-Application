/**
 * `scripts/font-metrics.mjs` against the constants it exists to produce.
 *
 * ## Why this is worth a test at all
 *
 * The four `minLineHeightRatio` / `naturalLineHeightRatio` pairs in
 * `theme/typography.ts` are the only numbers in the app that nobody can check
 * by reading. They are read out of TTF binaries, they are invisible until
 * someone holds a phone, and being wrong in either direction is silent: too
 * low clips Thai below-baseline vowels (the bug that shipped), too high
 * inflates leading app-wide (the bug the third `hheaBox` term nearly shipped).
 *
 * `theme/typography.test.ts` already restates them as literals, which pins
 * them against an accidental edit *to the source*. What neither it nor
 * anything else does is check them against the fonts — so a deliberate
 * hand-edit ("this looks a bit tight, bump it") that updates both the constant
 * and the literal passes every gate. This closes that: the script is run, and
 * its emitted numbers must equal what the registry declares.
 *
 * It also runs the script itself, which is otherwise never executed by CI. A
 * crash in the cmap reader after a font upgrade would currently be discovered
 * by the next person who ran it by hand.
 *
 * ## Why a subprocess
 *
 * `font-metrics.mjs` is a top-level script with no exports — it computes and
 * prints. Adding an export purely so a test could import it would be changing
 * production code to suit the test, and the printed report is the actual
 * interface a human uses. Parsing it asserts the thing that is really consumed.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { FONT_FAMILIES } from '@/theme/typography';

const CLIENT_ROOT = join(__dirname, '..');

type Row = {
  family: string;
  file: string;
  ascent: number;
  descent: number;
  gap: number;
  inkAbove: number;
  inkBelow: number;
  descentTerm: number;
  ascentTerm: number;
  natural: number;
  floor: number;
};

/** One per font file: the per-weight report the script prints as it measures. */
const ROW =
  /^(\S+)\s+(\S+\.ttf)\s+A (\S+) D (\S+) gap (\S+)\s+ink (\S+)\/(\S+)\s+descentTerm (\S+) ascentTerm (\S+)\s+natural (\S+)\s+floor (\S+)$/;

/** The paste-me block at the end — the numbers that end up in `FONT_FAMILIES`. */
const EMITTED = /^\s*(\w+): minLineHeightRatio: (\S+), naturalLineHeightRatio: (\S+)$/;

let output = '';
let rows: Row[] = [];
let emitted: Record<string, { minLineHeightRatio: number; naturalLineHeightRatio: number }> = {};

beforeAll(() => {
  // ~50ms: it reads ten TTFs and scans two code-point ranges. Run once for the
  // file rather than per test.
  output = execFileSync(process.execPath, ['scripts/font-metrics.mjs'], {
    cwd: CLIENT_ROOT,
    encoding: 'utf8',
  });

  rows = output
    .split('\n')
    .map((line) => line.match(ROW))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(([, family, file, a, d, gap, above, below, dTerm, aTerm, natural, floor]) => ({
      family,
      file,
      ascent: Number(a),
      descent: Number(d),
      gap: Number(gap),
      inkAbove: Number(above),
      inkBelow: Number(below),
      descentTerm: Number(dTerm),
      ascentTerm: Number(aTerm),
      natural: Number(natural),
      floor: Number(floor),
    }));

  emitted = Object.fromEntries(
    output
      .split('\n')
      .map((line) => line.match(EMITTED))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(([, id, min, natural]) => [
        id,
        {
          minLineHeightRatio: Number(min),
          naturalLineHeightRatio: Number(natural),
        },
      ]),
  );
});

describe('font-metrics.mjs', () => {
  it('measures every weight of every family the registry names', () => {
    // The script's `FAMILIES` table and `FONT_FAMILIES` are two hand-kept
    // lists. A family added to the registry and not to the script has no
    // measured floor at all, and the value in the registry is then a guess
    // wearing a measured number's clothes.
    const measured = Object.fromEntries(
      Object.keys(emitted).map((id) => [id, rows.filter((row) => row.family === id).length]),
    );

    expect(measured).toEqual({
      noto: Object.keys(FONT_FAMILIES.noto.weights).length,
      looped: Object.keys(FONT_FAMILIES.looped.weights).length,
      sarabun: Object.keys(FONT_FAMILIES.sarabun.weights).length,
      mono: Object.keys(FONT_FAMILIES.mono.weights).length,
    });
  });

  /**
   * **The assertion this file exists for.** Not "the constants are these
   * numbers" — `theme/typography.test.ts` already says that, and both it and
   * the source can be edited together. This says the constants are what the
   * *font binaries* produce, which is the claim the doc comments make and the
   * only one a device pass can rely on.
   *
   * Red when: someone hand-tunes a ratio, a `@expo-google-fonts` bump changes
   * a face's metrics, or the script's formula changes.
   */
  it('emits exactly the ratios FONT_FAMILIES declares', () => {
    const declared = Object.fromEntries(
      Object.entries(FONT_FAMILIES).map(([id, family]) => [
        id,
        {
          minLineHeightRatio: family.minLineHeightRatio,
          naturalLineHeightRatio: family.naturalLineHeightRatio,
        },
      ]),
    );

    expect(emitted).toEqual(declared);
  });

  /*
   * The formula, checked against the inputs the script printed beside it.
   * `floor = max(descentTerm, ascentTerm)` and nothing else — no third term.
   *
   * An earlier version took `max(…, hheaBox)` as well. That is the change this
   * catches: `hheaBox` for noto is 1.511 against a real requirement of 1.141,
   * so re-adding it would move the default family's floor by a third and
   * loosen every heading in the app as a side effect of a clipping fix.
   */
  it('takes the floor from the two clipping terms and no others', () => {
    for (const row of rows) {
      expect({ file: row.file, floor: row.floor }).toEqual({
        file: row.file,
        floor: Number(Math.max(row.descentTerm, row.ascentTerm).toFixed(3)),
      });
    }
  });

  it('derives each clipping term from the declared box and the measured ink', () => {
    for (const row of rows) {
      const box = row.ascent + row.descent;

      expect({
        file: row.file,
        descentTerm: row.descentTerm,
        ascentTerm: row.ascentTerm,
      }).toEqual({
        file: row.file,
        // Both at 2×, because `CustomLineHeightSpan` splits the leading evenly
        // between ascent and descent — covering a shortfall on one side costs
        // twice as much line height.
        descentTerm: Number((box + 2 * (row.inkBelow - row.descent)).toFixed(3)),
        ascentTerm: Number((box + 2 * (row.inkAbove - row.ascent)).toFixed(3)),
      });
    }
  });

  /**
   * The trip-wire for the assumption that lets `lineGap` stay out of the
   * formula.
   *
   * `CustomLineHeightSpan` computes `lineHeight - (-ascent + descent)` and
   * never reads `lineGap`, so excluding it is correct — but the reason nobody
   * has been bitten is that all four shipped faces declare it as zero, which
   * makes the two positions indistinguishable in the numbers. If a font
   * upgrade or a fifth family arrives with a non-zero gap, the exclusion stops
   * being invisible and someone has to look at it deliberately. This is that
   * someone's alarm clock; it is not asserting that the exclusion is wrong.
   */
  it('measures no family whose declared lineGap could hide the exclusion', () => {
    expect(rows.filter((row) => row.gap !== 0).map((row) => row.file)).toEqual([]);
  });

  /*
   * The rounding direction, on the one family where it is load-bearing. A
   * floor rounded *down* is not a floor: noto measures 1.141 and ships 1.15,
   * and `Math.floor`/`toFixed` here would ship 1.14 and reopen the gap the
   * clamp exists to close.
   */
  it('rounds a measured floor up to the ratio it ships, never down', () => {
    for (const [id, { minLineHeightRatio, naturalLineHeightRatio }] of Object.entries(emitted)) {
      const familyRows = rows.filter((row) => row.family === id);
      const worstFloor = Math.max(...familyRows.map((row) => row.floor));
      const worstNatural = Math.max(...familyRows.map((row) => row.natural));

      expect({ id, floorHolds: minLineHeightRatio >= worstFloor }).toEqual({
        id,
        floorHolds: true,
      });
      expect({
        id,
        naturalHolds: naturalLineHeightRatio >= worstNatural,
      }).toEqual({
        id,
        naturalHolds: true,
      });
      // …and up to 2dp, not to something arbitrarily generous: an over-rounded
      // floor is the leading redesign this mechanism refuses to be.
      expect({ id, min: minLineHeightRatio }).toEqual({
        id,
        min: Math.ceil(worstFloor * 100) / 100,
      });
    }
  });

  /*
   * `mono`'s scan range is the finding that produced it, restated as a
   * constraint: its floor is measured over digits and `/` only. Scanning
   * Latin Extended-A put `Ů` in charge and set it to 1.55 — 32% of extra line
   * box on the blood-pressure figure, from a glyph the face is never handed.
   * The ink numbers are what encode that, so they are what is asserted.
   */
  it('scans mono over the digits it renders, not a blanket Latin range', () => {
    const mono = rows.filter((row) => row.family === 'mono');

    expect(mono).not.toHaveLength(0);
    for (const row of mono) {
      // A diacritic-bearing capital would push `inkAbove` past the ascent and
      // make the ascent term win; digits do not.
      expect({ file: row.file, inkAbove: row.inkAbove <= row.ascent }).toEqual({
        file: row.file,
        inkAbove: true,
      });
      expect({ file: row.file, floorUnderNoto: row.floor < 1.15 }).toEqual({
        file: row.file,
        floorUnderNoto: true,
      });
    }
  });
});
