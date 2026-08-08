/**
 * Derives the per-family line-height floors in `src/theme/typography.ts`.
 *
 * Run it when a font family is added, swapped, or upgraded:
 *
 *     node scripts/font-metrics.mjs
 *
 * ## Why this exists
 *
 * The app shipped a flat 1.45 line-height floor, guessed. A device pass found
 * Thai below-baseline vowels (◌ุ ◌ู) still clipped in Sarabun and looped while
 * Noto was fine — so the floor is not one number, it is a property of each
 * font, and guessing it again would be the same mistake with a different
 * digit. These numbers are read out of the font binaries.
 *
 * ## What the numbers mean
 *
 * A TTF declares its line box in `hhea` (ascender / descender / lineGap) and
 * again in `OS/2` (usWinAscent / usWinDescent). Android lays text out to the
 * *declared* metrics, not to where the ink actually is — and **a font may
 * declare a descent shallower than its own glyphs**. Sarabun does exactly
 * that: `hhea.descender` is 0.232 em while ◌ู reaches 0.353 em below the
 * baseline. Everything below the declared line is outside the line box and is
 * clipped, with no warning anywhere.
 *
 * React Native's `CustomLineHeightSpan` is what makes an explicit `lineHeight`
 * trigger it. Transcribed from
 * `ReactAndroid/.../internal/span/CustomLineHeightSpan.kt:41-43`, which is
 * three unconditional lines:
 *
 *     leading  = lineHeight - (-ascent + descent)
 *     ascent  -= ceil(leading / 2)
 *     descent += floor(leading / 2)
 *
 * There is no branch and no floor at zero — a negative `leading` shrinks both
 * sides. `ascent`/`descent` come from `hhea`, and the span overwrites
 * `top`/`bottom` with them, which is how `includeFontPadding`'s extra room
 * (deep enough on its own) stops helping. So, with A and D the `hhea` ascent
 * and descent and `hheaBox = A + D`:
 *
 *     descent available = D + (lineHeight - hheaBox) / 2
 *     ascent  available = A + (lineHeight - hheaBox) / 2
 *
 * and the floor is the smallest ratio at which both cover the ink:
 *
 *     floor = max(hheaBox + 2 × (inkBelow - D),
 *                 hheaBox + 2 × (inkAbove - A))
 *
 * **Those two terms are the whole constraint.** An earlier version of this
 * script took `max(…, hheaBox)` as well, on the view that a font's own
 * declared box is a floor worth honouring. It is a defensible typographic
 * position and it is not this one: that third term is not derived from the
 * span's clipping behaviour, it won for `noto` (1.511 against a real
 * requirement of 1.141), and it would have quietly loosened leading across
 * the default family — an app-wide redesign smuggled in as a bug fix. The
 * floor is the clipping minimum and nothing else.
 *
 * `lineGap` is likewise absent: the span never reads it. All four fonts here
 * declare `lineGap == 0` so it made no difference, which is exactly why it
 * would have been a trap for the fifth.
 *
 * `naturalRatio` (the OS/2 win box) is reported separately. That is the box a
 * run of text takes when it carries **no** `lineHeight` at all, and it is what
 * a fixed-height container has to be able to hold — see the tab bar in
 * `app/(tabs)/_layout.tsx`.
 *
 * **Each family is scanned over the code points it actually renders in this
 * app**, not over a blanket Latin range. Scanning Latin Extended-A put `Ů`
 * (U+016E) in the driver's seat: it set `mono`'s floor to 1.55 when `mono` is
 * locked to blood-pressure digits and `/`, inflating the hero figure's line
 * box by 32%. A floor derived from glyphs a face cannot be asked to draw is
 * not a measurement of anything.
 *
 * No dependency on fontkit or opentype.js — this reads the four tables it
 * needs directly, so it cannot rot behind a version bump of a parser we would
 * otherwise install for one script.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What each family is asked to render in this app. See the header — a floor
 * is only meaningful over the glyphs the face can actually be handed.
 */
const THAI = [
  // The Thai block: consonants, vowels, tone marks, Thai digits.
  [0x0e00, 0x0e7f],
  // Basic Latin only. The app's Thai copy is interleaved with ASCII — digits,
  // punctuation, "SYS"/"DIA"/"mmHg", email addresses — and nothing else.
  // Accented Latin is deliberately out: no screen composes it, and including
  // it hands the floor to a glyph nobody will ever see.
  [0x0020, 0x007e],
];

/** id → the weights we actually load. Keep in step with `app/_layout.tsx`. */
const FAMILIES = {
  noto: {
    scan: THAI,
    files: [
      '@expo-google-fonts/noto-sans-thai/400Regular/NotoSansThai_400Regular.ttf',
      '@expo-google-fonts/noto-sans-thai/500Medium/NotoSansThai_500Medium.ttf',
      '@expo-google-fonts/noto-sans-thai/600SemiBold/NotoSansThai_600SemiBold.ttf',
      '@expo-google-fonts/noto-sans-thai/700Bold/NotoSansThai_700Bold.ttf',
    ],
  },
  looped: {
    scan: THAI,
    files: [
      '@expo-google-fonts/noto-sans-thai-looped/400Regular/NotoSansThaiLooped_400Regular.ttf',
      '@expo-google-fonts/noto-sans-thai-looped/700Bold/NotoSansThaiLooped_700Bold.ttf',
    ],
  },
  sarabun: {
    scan: THAI,
    files: [
      '@expo-google-fonts/sarabun/400Regular/Sarabun_400Regular.ttf',
      '@expo-google-fonts/sarabun/700Bold/Sarabun_700Bold.ttf',
    ],
  },
  mono: {
    /*
     * Digits and the separator, and that is the entire vocabulary. `mono` is
     * never the app-wide preference — it is pinned to the blood-pressure
     * figure by `family="mono"` on nine nodes, all of which render
     * `{systolic}`, `/`, `{diastolic}`. Scanning anything else sets this
     * family's floor from a glyph it will never be handed.
     */
    scan: [
      [0x002f, 0x002f],
      [0x0030, 0x0039],
    ],
    files: [
      '@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf',
      '@expo-google-fonts/ibm-plex-mono/700Bold/IBMPlexMono_700Bold.ttf',
    ],
  },
};

const u16 = (b, o) => b.readUInt16BE(o);
const i16 = (b, o) => b.readInt16BE(o);
const u32 = (b, o) => b.readUInt32BE(o);

function readTables(b) {
  const out = {};
  const count = u16(b, 4);
  for (let i = 0; i < count; i += 1) {
    const o = 12 + i * 16;
    out[b.toString('latin1', o, o + 4)] = { offset: u32(b, o + 8), length: u32(b, o + 12) };
  }
  return out;
}

/** Unicode → glyph id, from cmap format 4 or 12. */
function readCmap(b, t) {
  const { offset } = t['cmap'];
  let sub = null;
  for (let i = 0; i < u16(b, offset + 2); i += 1) {
    const p = offset + 4 + i * 8;
    const platform = u16(b, p);
    const encoding = u16(b, p + 2);
    const isUnicode =
      (platform === 3 && (encoding === 1 || encoding === 10)) ||
      (platform === 0 && (encoding === 3 || encoding === 4));
    if (isUnicode) sub = offset + u32(b, p + 4);
  }
  if (sub === null) throw new Error('no unicode cmap subtable');

  const map = new Map();
  const format = u16(b, sub);

  if (format === 4) {
    const segX2 = u16(b, sub + 6);
    const seg = segX2 / 2;
    const endsAt = sub + 14;
    const startsAt = endsAt + segX2 + 2;
    const deltasAt = startsAt + segX2;
    const rangesAt = deltasAt + segX2;

    for (let i = 0; i < seg; i += 1) {
      const end = u16(b, endsAt + i * 2);
      const start = u16(b, startsAt + i * 2);
      const delta = i16(b, deltasAt + i * 2);
      const rangeOffset = u16(b, rangesAt + i * 2);
      if (start === 0xffff) continue;

      for (let cp = start; cp <= Math.min(end, 0xfffe); cp += 1) {
        let gid;
        if (rangeOffset === 0) {
          gid = (cp + delta) & 0xffff;
        } else {
          const gi = rangesAt + i * 2 + rangeOffset + (cp - start) * 2;
          if (gi + 2 > b.length) continue;
          gid = u16(b, gi);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) map.set(cp, gid);
      }
    }
  } else if (format === 12) {
    const groups = u32(b, sub + 12);
    for (let i = 0; i < groups; i += 1) {
      const p = sub + 16 + i * 12;
      const start = u32(b, p);
      const end = u32(b, p + 4);
      const gid = u32(b, p + 8);
      for (let cp = start; cp <= end; cp += 1) map.set(cp, gid + (cp - start));
    }
  } else {
    throw new Error(`unsupported cmap format ${format}`);
  }

  return map;
}

/** yMin / yMax for one glyph, or null for an empty one (a space has no outline). */
function glyphBounds(b, t, indexToLocFormat, gid) {
  const loca = t['loca'].offset;
  const glyf = t['glyf'].offset;

  const start =
    indexToLocFormat === 0 ? u16(b, loca + gid * 2) * 2 : u32(b, loca + gid * 4);
  const end =
    indexToLocFormat === 0 ? u16(b, loca + gid * 2 + 2) * 2 : u32(b, loca + gid * 4 + 4);
  if (end <= start) return null;

  const p = glyf + start;
  return { yMin: i16(b, p + 4), yMax: i16(b, p + 8) };
}

function measure(relativePath, scan) {
  const b = readFileSync(join(root, 'node_modules', relativePath));
  const t = readTables(b);

  const head = t['head'].offset;
  const upem = u16(b, head + 18);
  const indexToLocFormat = i16(b, head + 50);

  const hhea = t['hhea'].offset;
  const hheaAscent = i16(b, hhea + 4) / upem;
  const hheaDescent = -i16(b, hhea + 6) / upem;
  // `lineGap` is read for the report only. `CustomLineHeightSpan` never
  // touches it, so it must not enter the floor — see the header.
  const hheaGap = i16(b, hhea + 8) / upem;

  const os2 = t['OS/2'].offset;
  const winAscent = u16(b, os2 + 74) / upem;
  const winDescent = u16(b, os2 + 76) / upem;

  const cmap = readCmap(b, t);
  let inkAbove = 0;
  let inkBelow = 0;
  for (const [lo, hi] of scan) {
    for (let cp = lo; cp <= hi; cp += 1) {
      const gid = cmap.get(cp);
      if (!gid) continue;
      const bounds = glyphBounds(b, t, indexToLocFormat, gid);
      if (!bounds) continue;
      inkAbove = Math.max(inkAbove, bounds.yMax / upem);
      inkBelow = Math.max(inkBelow, -bounds.yMin / upem);
    }
  }

  // Not `+ hheaGap`: the span computes `-ascent + descent` and never reads
  // the gap.
  const hheaBox = hheaAscent + hheaDescent;
  return {
    hheaAscent,
    hheaDescent,
    hheaGap,
    hheaBox,
    naturalBox: winAscent + winDescent,
    inkAbove,
    inkBelow,
    // The span splits `leading` evenly, so covering a shortfall on one side
    // costs twice that much line height. These two terms are the whole
    // constraint — see the header for the third one that used to be here and
    // why it is gone.
    floor: Math.max(
      hheaBox + 2 * (inkBelow - hheaDescent),
      hheaBox + 2 * (inkAbove - hheaAscent),
    ),
  };
}

const pct = (n) => n.toFixed(3);
const rows = [];

for (const [id, { scan, files }] of Object.entries(FAMILIES)) {
  let floor = 0;
  let natural = 0;
  for (const file of files) {
    const m = measure(file, scan);
    floor = Math.max(floor, m.floor);
    natural = Math.max(natural, m.naturalBox);
    console.log(
      `${id.padEnd(8)} ${file.split('/').pop().padEnd(34)} ` +
        `A ${pct(m.hheaAscent)} D ${pct(m.hheaDescent)} gap ${pct(m.hheaGap)}  ` +
        `ink ${pct(m.inkAbove)}/${pct(m.inkBelow)}  ` +
        `descentTerm ${pct(m.hheaBox + 2 * (m.inkBelow - m.hheaDescent))} ` +
        `ascentTerm ${pct(m.hheaBox + 2 * (m.inkAbove - m.hheaAscent))}  ` +
        `natural ${pct(m.naturalBox)}  floor ${pct(m.floor)}`,
    );
  }
  // Rounded up to 2dp: the emitted px are integers, so a third decimal cannot
  // survive `Math.ceil(fontSize * ratio)` anyway.
  rows.push({
    id,
    minLineHeightRatio: Math.ceil(floor * 100) / 100,
    naturalLineHeightRatio: Math.ceil(natural * 100) / 100,
  });
}

console.log('\nPaste into FONT_FAMILIES in src/theme/typography.ts:\n');
for (const row of rows) {
  console.log(
    `  ${row.id}: minLineHeightRatio: ${row.minLineHeightRatio}, ` +
      `naturalLineHeightRatio: ${row.naturalLineHeightRatio}`,
  );
}
