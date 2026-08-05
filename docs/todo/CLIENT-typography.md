# Client: typography, the typeface, and what the sweep left behind

> **Status: the mechanism is done and applied app-wide; the *design* decision
> it exposed is not made.** Every piece of text in `client/src` now renders
> through `ThemedText`, scales with the user's font-size preference, and uses
> Noto Sans Thai. What is unresolved is whether the sizes it renders are a
> typography scale or a pile of accidents — the evidence says the latter, and
> §3 is the decision that needs a human.
>
> **Nothing in this file has been exercised on a physical device.** That is
> load-bearing here more than anywhere else in the todo folder: this changed
> the typeface and the line height of every screen in the app.

Companion to [CLIENT-onboarding.md](./CLIENT-onboarding.md), which owns the
font-size *preference* (where it is stored, how the setup screen previews it).
This file owns what that preference is applied to.

---

## What is real now

| Piece | Where |
| --- | --- |
| The text component | [`components/themed-text.tsx`](../../client/src/components/themed-text.tsx) |
| Its tests | `components/themed-text.test.tsx` — 13, covering scale, OS compensation, family-by-weight, and `style` precedence |
| The scale multiplier | [`hooks/use-font-scale.ts`](../../client/src/hooks/use-font-scale.ts) |
| Font family names, keyed by weight | `ThaiFontFamily` in [`constants/theme.ts`](../../client/src/constants/theme.ts) |
| Font loading | `app/_layout.tsx` — 400 / 500 / 600 / 700, blocking the splash |

319 `ThemedText` nodes. Six raw `<Text>` remain, each deliberate (§4).

### Three things that must not be undone

1. **`useFontScale()` divides the OS accessibility scale out.** `<Text>` has
   `allowFontScaling` defaulting to `true`, so RN multiplies the system font
   size on top of whatever we compute. Left alone the two compound: OS at 130 %
   with the app at `xlarge` was ~1.79×, and the setup screen — which previews
   the choice as a px number — was lying on any device whose system font size
   was not the default. Dividing here and letting RN multiply back makes the
   net size exactly `base × preference`. Remove the division and the preview
   becomes wrong again, silently, on other people's phones.

2. **Weight selects a font *file*, not a `fontWeight`.** On Android a
   `fontWeight` next to an explicit `fontFamily` is ignored or synthesised.
   `ThemedText` maps `weight` through `ThaiFontFamily` and emits **no**
   `fontWeight` at all. A test asserts that. Two places in the app were
   pairing `NotoSansThai_400Regular` with `fontWeight: 'bold'` before this and
   rendering the wrong face.

3. **Every weight `ThemedText` can name must be loaded in `_layout.tsx`.** An
   unloaded family name does not throw — it silently falls back to the system
   font, which is a different Thai face per OEM and the reason the app bundles
   one. There is a test pinning the two lists together.

---

## 1. `className` on a `ThemedText` is layout only — colour and size fail silently

Both of these were live in the app and were found by sweeping it, not by
reading it. They will come back the moment someone writes what looks like
ordinary NativeWind.

- **`text-white` is dropped.** The component's style object is applied after
  NativeWind's, so the class loses outright. Thirteen nodes would have
  rendered `#2C3E50` on a gradient. Colour goes through `themeColor`, or
  through `style` for a value that is not a token (white on a filled surface,
  a BP-severity tint).
- **`text-[15px]` is worse than dropped: it works, and never scales.** A
  Tailwind arbitrary value is a fixed px. Nine nodes — the onboarding shell,
  the auth tabs, the avatar picker, the setup screen's own section labels —
  were ignoring the font-size preference entirely. Converting them fixed an
  accessibility defect that predated the sweep.

The reasoning about which wins went the *wrong way* before it was checked. If
you change how styles are composed here, probe the rendered style rather than
reasoning about precedence.

**Worth doing:** an ESLint rule banning `text-white`, `text-[…]`, and
`text-sm`-family classes on `ThemedText`. It is the only mechanical guard
against a trap whose failure mode is invisible in review.

---

## 2. A `lineHeight` or `fontSize` in `style` is not scaled

The variant's numbers go through the multiplier; a literal in `style` does
not. It looks correct on a dev device at default settings and silently stops
tracking the preference. This is why `size` and `lineHeight` are **props**
rather than something you pass through `style`.

---

## 3. The decision this is all waiting on: is there a typography scale?

**There is not, and the evidence is now countable.** `ThemedText`'s variants
are the sizes the app already used, given role names. That was the right move
to get the typeface applied without redesigning anything, and it is not a
scale.

Current variant use (319 nodes):

| variant | px | uses |
| --- | --- | --- |
| `body` | 15 | 82 |
| `label` | 13 | 58 |
| `small` | 14 | 52 |
| `caption` | 12 | 32 |
| `default` | 16 | 52 (24 explicit + 28 implicit) |
| `bodyLarge` | 17 | 16 |
| `heading` | 20 | 6 |
| `title` | 24 | 3 |
| `display` / `smallBold` / `code` / `link` | — | 2 / 2 / 2 / 1 |

And `size={n}` — the escape hatch — is the inventory of what the scale does
**not** name. `grep 'size={' client/src` gives it:

| size | uses | what |
| --- | --- | --- |
| 18 | 10 | section and screen headings, across 7 files |
| 19 | 4 | prose headings in about / help / health-tips |
| 48 / 38 | 3 / 3 | the blood-pressure figure, hero card and history row |
| 36 | 1 | the "/" between systolic and diastolic on the detail screen |
| 28 / 26 / 22 | 1 each | auth hero, onboarding hero, app-lock gate |
| 11 | 1 | one caption on home |
| `SIZE_FONT[size]`, `INITIALS_FONT[size]` | 1 each | a button's own size prop; avatar initials |

Three questions fall out of that table, and they are genuinely design
decisions rather than engineering ones:

**(a) Headings are at 18 *and* 20.** Ten nodes at 18 are section headings;
`heading` is 20 and has six. Two heading sizes one step apart is the accident
pattern. Either 18 becomes `heading` and 20 folds into it, or the reverse, or
both are real and the scale needs `heading` and `subheading` — but somebody
has to look at the screens and say which.

**(b) The blood-pressure figure renders at three sizes.** 48 on the home hero
card, 44 on the reading detail screen, 38 in a history row. The same number,
the same meaning. Each is defensible as hero / detail / list item; the set is
not, because nobody chose 38 as "one step below 44". **This wants deciding
with all three surfaces open side by side**, which is why it was not folded
one at a time.

**(c) Are 15 / 14 / 13 three steps or one?** They are 82 + 52 + 58 nodes
sitting one pixel apart. At the `small` font-size rung they round to 12 / 12 /
11 — the hierarchy stops existing. Either they are a real three-level system
that should be spaced properly (a ratio scale would put them at roughly 13 /
15 / 17), or two of them are the same thing and should merge. Merging is a
visual change across ~190 nodes and needs to be a decision, not a refactor.

**Do not answer (a)–(c) by adding variants one at a time.** That is how the
current set came to exist. If a fourth heading size shows up, that is more
evidence for the redesign, not a request for `headingSmaller`.

### What a decision would cost

- **Answering (a) and (b) only** — repoints ~20 nodes, no ratio work. A day,
  and it removes the two clearest accidents.
- **A real ratio scale** — changes sizes on nearly every screen. It needs the
  device pass in §5 first, because judging a scale from a jest snapshot is not
  possible.

---

## 4. The six raw `<Text>` that stay

Not oversights. Each would be wrong to convert.

| Where | Why |
| --- | --- |
| `components/ui/font-size-picker.tsx` (3) | The preview of each font-size option, and the sample paragraph under it. They must **not** scale with the current preference — they show the user what each setting looks like, so scaling them would make the control preview itself. |
| `app/onboarding/setup.tsx` (1) | Same: `PREVIEW_SIZE[fontSize]` is the sample text for the size being chosen. |
| `modules/readings/components/bp-trend-chart.tsx` (1) | `axisFontSize + 1`, pinned to a prop handed to the chart library. The pointer label reading one step larger than the axis it floats over is the point. |
| `modules/community/components/post-card.tsx` (1) | Uses `onTextLayout` with a dynamic `numberOfLines` to decide whether to offer "อ่านต่อ". |

Converting any of the first two breaks the font-size picker: the control would
preview whatever is already selected instead of each option. The other two
break a chart's visual hierarchy and a "read more" affordance, neither of
which any test covers.

---

## 5. Nothing has run on a device, and here that matters most

This changed the typeface and the line height of every screen. The specific
things a device pass has to look at, in order of how likely they are to be
wrong:

1. **Thai diacritic clipping at the largest font-size rung.** Line heights sit
   at ~1.45–1.5×, chosen because Thai stacks สระบน plus วรรณยุกต์ two levels
   deep. Words like `เสื้อ`, `ที่`, `ผู้` in a `heading` at `xlarge` are the
   test. Clipping means the ratio is still too tight.
2. **A device with a non-default system font size.** Set Android's font size
   to Large, then walk the app at each of the four in-app steps. The rendered
   size must depend only on the in-app setting. If text grows twice, the OS
   compensation in `useFontScale` has been undone.
3. **The whole app at `xlarge`.** Row heights, `numberOfLines={1}` truncation,
   the two-line pill in `tab-buttons`, buttons whose label now wraps.
4. **Every screen once, at default, just to look at it.** A typeface change is
   the definition of something that passes tests and looks wrong.

---

## 6. Outstanding, unrelated to typography but blocking nothing else

- **The invite card's accept button has no white.** Icon, label and spinner in
  `modules/caregivers/components/invite-decision-card.tsx` render at
  `text-primary` on `colors.primary` — roughly 2.0:1 in light mode, against
  4.5:1 for a button label. It is the primary action of the card a patient
  uses to decide who may read their medical history. A one-line fix
  (`style={{ color: '#FFFFFF' }}` plus `color="#FFFFFF"` on the two icons and
  the `ActivityIndicator`) that was left alone because the white was removed
  deliberately by a human edit — confirm the intent before changing it back.
- **A `themeColor` contrast check under `__DEV__`.** `text-secondary` on
  `surface-muted` is ~3.9:1 in light mode, under 4.5:1. A dev-only warning
  when a `ThemedText`'s resolved colour fails against its nearest known
  background would catch this class at write time. Needs a way to know the
  background, which is the hard part — possibly a `on` prop naming the surface.
- **`react-native-css` / NativeWind v5.** The project is on v4.2. v5 changes
  how className styles are composed, which is exactly the mechanism §1
  depends on. Re-probe the precedence before upgrading, and keep the probe.

---

## Where to start a fresh session

If the goal is **finishing typography**: §3 is the only real work, and it
needs §5 first. Read §3's table, then open the three blood-pressure surfaces
side by side.

If the goal is **anything else**: this file is done for now and
[CLIENT-remaining.md](./CLIENT-remaining.md) has the rest.
