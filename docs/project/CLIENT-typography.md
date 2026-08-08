---
title: "Client: typography, the typeface, and the type scale"
description: The centralised typography resolver, the user-selectable font family, and the now-closed type-scale consolidation.
status: current
updated: 2026-08-09
owner: client
---

# Client: typography, the typeface, and the type scale

> **Status: the mechanism is done and centralised, and the design decision it
> exposed is now made.** Every rendered px in `client/src` comes out of one
> resolver, scales with the user's font-size preference, and renders in the
> typeface the user picked. The scale those sizes come from was a pile of
> accidents; §3 records the consolidation that turned it into eight roles, and
> is closed.
>
> **Nothing in this file has been exercised on a physical device.** That is
> load-bearing here more than anywhere else in the todo folder: it changed the
> typeface and the line height of every screen in the app, and then §3 changed
> the size of roughly 200 text nodes on top of that.

Companion to [CLIENT-onboarding.md](./CLIENT-onboarding.md), which owns the
font-size *preference* (where it is stored, how the setup screen previews it).
This file owns what that preference is applied to.

---

## What is real now

| Piece | Where |
| --- | --- |
| **The resolver** — the only multiplication in the app, in four forms | [`hooks/use-typography.ts`](../../client/src/hooks/use-typography.ts) |
| The data it reads: size ladder, role scale, family registry | [`theme/typography.ts`](../../client/src/theme/typography.ts) |
| Which families the device has actually loaded | [`theme/font-loading.tsx`](../../client/src/theme/font-loading.tsx) |
| The text component (now one caller among several) | [`components/themed-text.tsx`](../../client/src/components/themed-text.tsx) |
| The OS-compensated size multiplier | [`hooks/use-font-scale.ts`](../../client/src/hooks/use-font-scale.ts) |
| The two user-facing controls | `components/ui/font-size-picker.tsx`, `components/ui/font-family-picker.tsx` |
| Font loading | `app/_layout.tsx` — Noto 400/500/600/700 blocking; looped, Sarabun, mono deferred |

319 `ThemedText` nodes. Six raw `<Text>` remain, each deliberate (§4).

### Why the resolver returns a style and not a component

`ThemedText` covers the great majority of the app's text, but it could never
cover all of it, and the sites it cannot reach were each keeping their own copy
of `Math.round(base * fontScale)`:

- **Four `<TextInput>`** — `text-field.tsx`, the two community composers,
  and the two health-form textareas. A text component cannot wrap an input.
- **A chart library's props** — `bp-trend-chart.tsx` hands `yAxisTextStyle`,
  `xAxisLabelTextStyle`, and `textFontSize` to `react-native-gifted-charts`,
  which takes styles, not children.
- **A navigator's `tabBarLabelStyle`** — same shape, in `(tabs)/_layout.tsx`.
- **The six raw `<Text>` of §4**, each raw for a reason that survives.

Fourteen copies of one expression is how the font-*family* preference would
have arrived applying to some text and not the rest. A `TextStyle` merges into
every one of those call sites; a component merges into none of them. **After
this change `Math.round(x * fontScale)` must not exist anywhere outside
`use-typography.ts`.**

### The font family is a user preference

`fontFamily` lives in `preferences.store.ts` beside `fontSize`, defaults to
`noto`, and is offered by `FontFamilyPicker`. The registry is `FONT_FAMILIES`:

| id | face | weights | Thai | offered? |
| --- | --- | --- | --- | --- |
| `noto` | Noto Sans Thai | 400/500/600/700 | full | yes — the default |
| `looped` | Noto Sans Thai **Looped** (ตัวไทยมีหัว) | 400/700 | full | yes |
| `sarabun` | Sarabun | 400/700 | full | yes |
| `mono` | IBM Plex Mono | 400/700 | **latin-only** | **no — internal** |

Three things to know:

- **What blocks the splash is what every user sees whether they chose it or
  not** — Noto, and `mono`. Only `looped` and `sarabun` are deferred to after
  `usePreferencesStore.hydrate()`. Adding font binary to the blocking path
  taxes every cold start for every user, and the audience is elderly patients
  on mid-range Android, so a family somebody actively picked is worth a brief
  FOUT. `mono` is not one of those: it is pinned to the blood-pressure figure
  for everyone, so deferring it made the hero digits change typeface **and
  size** mid-launch on every cold start — `opticalScale` is 0.96, so
  `size={48}` emitted 48 before the swap and 46 after, racing the readings
  query on the app's primary screen. **The rule: a family nobody opts into
  must not be deferred.** `typography.test.ts` asserts it both ways.
- **The resolver never names a font that is not loaded.** An unregistered
  `fontFamily` does not throw; RN silently substitutes the OEM's own Thai face,
  which differs per manufacturer and is the whole reason the app bundles one.
  `theme/font-loading.tsx` reports what has landed, and anything else resolves
  to Noto until it does.
- **`mono` is internal and must never reach the picker.** It is the blood-
  pressure figure's typeface, so `120/80` occupies the same width in the home
  hero card, a history row, and the detail screen — proportional digits make a
  column of readings jitter, and comparing down that column is what those
  screens are for. `FontFamilyPicker` filters on `thai === 'full'` rather than
  on a hand-written exclusion list, so a Latin-only family added later cannot
  leak in by omission.

`opticalScale` corrects for the fact that two faces at the same nominal px do
not read as the same size. **The three non-Noto values are estimates read off
the fonts' metrics and have not been verified on a device** — see §5.

### The Thai line-box floor — per-family, and measured

`use-typography.ts` clamps every emitted line height up to a **per-family**
minimum ratio, read out of the font binaries by
[`scripts/font-metrics.mjs`](../../client/scripts/font-metrics.mjs). It is a
floor, not an exact value: ask for more leading and you get it.

| family | `minLineHeightRatio` | `naturalLineHeightRatio` | scanned glyphs |
| --- | --- | --- | --- |
| noto | **1.15** | 1.52 | Thai + Basic Latin |
| looped | **1.55** | 1.74 | Thai + Basic Latin |
| sarabun | **1.55** | 1.86 | Thai + Basic Latin |
| mono | **1.03** | 1.30 | digits and `/` |

**The floor is the clipping minimum and nothing else.** It is deliberately not
raised to the font's own declared box, even though three of the four families
declare a larger one — see "What it does *not* do" below. The consequence is
the acceptance criterion for this whole mechanism: **a Noto user sees no pixel
change from it, and neither does the blood-pressure figure.** Both are asserted
in `use-typography.test.ts`.

**Each family is scanned over the code points it actually renders.** A floor
derived from a glyph a face cannot be handed is not a measurement of anything —
`mono` is locked to blood-pressure digits and `/`, and scanning accented Latin
put `Ů` (U+016E) in charge of its floor.

#### The mechanism, measured rather than guessed

A TTF declares its line box in `hhea`, and Android lays text out to the
**declared** metrics rather than to where the ink actually is. A font may
declare a descent shallower than its own glyphs — and Sarabun does:

| family | declared `hhea` descent | deepest ◌ู reaches | clipped |
| --- | --- | --- | --- |
| noto | 0.450 em | 0.265 em | none |
| looped | 0.350 em | 0.324 em | none via this path |
| sarabun | **0.232 em** | **0.353 em** | ~34 % of the vowel |

React Native's `CustomLineHeightSpan` is what makes an explicit `lineHeight`
trigger it. The whole span is three unconditional lines
(`ReactAndroid/.../internal/span/CustomLineHeightSpan.kt:41-43`):

```kotlin
val leading = lineHeight - ((-fm.ascent) + fm.descent)
fm.ascent -= ceil(leading / 2.0f).toInt()
fm.descent += floor(leading / 2.0f).toInt()
```

No branch, no clamp at zero, and it never reads `lineGap`. It also overwrites
`top`/`bottom` with `ascent`/`descent`, which is how `includeFontPadding`'s
extra room — deep enough on its own — stops helping. Every term is linear in
em, so **the constraint is purely a ratio** and is scale-invariant. Covering a
shortfall costs twice as much line height, because the leading is split evenly:

```
floor = max(hheaBox + 2 × (inkBelow − hheaDescent),
            hheaBox + 2 × (inkAbove − hheaAscent))
```

#### What it does *not* do, and why

An earlier version of the formula took `max(…, hheaBox)` as a third term — the
font's own declared line box as a floor worth honouring. That is a defensible
typographic position, and it is not this one:

- It is **not derived from the span's clipping behaviour.** The two ink terms
  are the entire constraint; the third was an aesthetic preference wearing a
  measurement's clothes.
- It **won for `noto`** — 1.511 against a real requirement of 1.141 — and so
  would have loosened `heading`, `title`, and `display` across the *default*
  family. An app-wide leading change, shipped as a side effect of a clipping
  fix, on the branch that was supposed to add a font picker.
- It **inflated `mono`**, whose floor it pushed to 1.55: the blood-pressure
  figure's line box grew 32 % on the detail screen and stopped matching the
  slash beside it inside a `flex-row items-end`. (That slash was `size={36}`
  against `type="display"` digits at the time. §3(b) has since put both at
  `size={38}`, so the pair can no longer diverge — but the failure mode this
  bullet describes is still live for any two differently-specced nodes sharing
  an `items-end` row.)

If someone later wants the app's leading to honour declared boxes, that is a
real proposal — but it is a typography decision on its own branch, taken with
§3, not a line in a bug fix. Do not re-add the term because it looks obviously
correct.

#### There are two bugs here, not one

The device pass reported clipping in two places with very different severity,
and they have different causes. Conflating them produces a fix for one:

| surface | `lineHeight` | cause | fix |
| --- | --- | --- | --- |
| profile name (`type="heading"`) | explicit | Sarabun's declared descent is shallower than its ink | the per-family floor |
| bottom tab labels | **`null`** | natural box is 15 % / 23 % taller than Noto's; the bar's height is fixed | `labelHeadroom` on the bar |

**`lineHeight: null` bypasses the floor entirely, by construction** — a
`<TextInput>` that asked for no line height must still get none or the caret
re-centres. Those sites keep the font's *natural* box, which is
`naturalLineHeightRatio`, and that is only a problem where a container's
height was fixed against Noto. The bottom tab bar is the one such container;
`hooks/use-tab-bar-geometry.ts` adds the difference back. Every other `null`
site is an elastic container (an input with padding, a chart label the library
positions) and grows to fit.

#### Style units and layout units are not the same number

**Any container dimension derived from a resolved font size must come from
`useLayoutTypography()`, never from `useTypography()`.** This is its own
failure mode and it shipped twice before it was caught.

`useTypography()` returns *style* units, with the OS accessibility scale
divided out — see `hooks/use-font-scale.ts` for why that division exists. RN
multiplies it back at paint time because `allowFontScaling` is on. A container
dimension is dp and **nothing scales it**, so sizing one from an emitted value
under-reserves by exactly the OS scale factor:

```
osScale 1.0  →  emitted 16, paints 16.0   ✔ container fits
osScale 2.0  →  emitted  8, paints 16.0   ✘ container half the size needed
```

Two instances, both found by `expo-test-author` rather than by looking:

| site | dimension | symptom at a raised system font size |
| --- | --- | --- |
| `use-tab-bar-geometry.ts` | `labelHeadroom` | headroom shrinks as the OS setting grows — the Thai-clipping fix switches itself off |
| `tab-buttons.tsx` | `minHeight` | pill collapses to the 44dp floor while its two painted lines need 60 — **every family, Noto included** |

**Why this class is worth naming rather than fixing twice.** A dev device sits
at OS scale 1, where the two spaces coincide exactly, so the bug is invisible
in every screenshot, every simulator run, and every test that does not mock
`fontScale`. And the population it fails is precisely the one the typography
work exists for: someone who raised their system font size for legibility is
the same person who picks the looped face for legibility. A fix that reads
correct on the bench and breaks for the target user is the worst shape a
defect can have here.

`src/hooks/use-tab-bar-geometry.test.tsx` pins the invariant directly —
"reserves room for the box the label actually paints", asserted at OS scale 2.

##### The same confusion in the other direction — fixed, with a fourth form

`typographyFor()` is the pure form and carries **no** OS compensation, so a
number from it going into a `style` prop *compounds* the OS scale instead of
under-reserving. Both pickers did this for their samples, because previewing a
preference the user has not selected requires arbitrary preferences and the
hook is bound to the current ones.

The size picker's sample was the one that misled: at OS scale 1.3 the "16px"
option painted 20.8 while the app rendered it at 16 — the preview lying, which
is the exact bug `use-font-scale.ts` was written to prevent. **It was not
new**; `main` had it too, where the sample was a raw `FONT_SIZE_STEPS` value in
a `style` prop.

The fix is `usePreviewTypography()`, and the "fourth resolver form" framing
held up — the resolver has two independent axes and the app needs three of the
four cells:

| unit space | current preference | arbitrary preference |
| --- | --- | --- |
| style | `useTypography()` | `usePreviewTypography()` |
| dp | `useLayoutTypography()` | `typographyFor()` |

What it did *not* need was a fourth pure function. `typographyFor` already took
arbitrary preferences; the only thing missing was the OS division, and that
cannot live in a pure function because there is no device to ask — the same
reason `useFontScale` is a hook. So the new form is a hook over the resolver
that `typographyFor` already calls, and it reads `useLoadedFontFamilies()`
itself rather than taking it as a parameter, which removed that argument from
both call sites.

**The family picker moved too**, though its version of the bug is milder: the
choice there is a typeface, so the shapes are right at any size, but the sample
painted a third larger than the `bodyLarge` running text it stands in for and
larger than the `label` description above it in the same card. Judging a face
at a size the app never renders is the weaker form of the same problem, and
exempting it would have cost a comment explaining why one picker follows a rule
the file beside it does not.

**The tests were asserting the bug.** jest-expo reports `fontScale: 2`, so
`__test__/components/font-size-picker.test.tsx` was running in exactly the
raised-scale state the defect lives in and pinning the compounded value as
correct. Both picker tests now pin the OS scale to 1 by default — the pattern
`use-tab-bar-geometry.test.tsx` established — and vary it deliberately in a
final block that asserts through the *paint* (`emitted × osScale`) rather than
through the emitted number.

**Still wants a device pass** (§5): what these two controls paint at a raised
system font size has still never been seen on hardware, only asserted.

#### What this replaced, and why the first two attempts failed

**Attempt 1 — a flat 1.45, guessed, with an exemption for `display` / `title` /
`heading`.** Both halves were wrong:

- **The flat number was validated against Noto**, which declares a 0.450 em
  descent against a 0.265 em deepest mark and therefore could not clip at any
  plausible ratio. A floor tested on the one family that never had the problem
  says nothing about the two that did.
- **The exemption was justified by absolute descent room** — "a 44px face in a
  52px box has 8px of slack, a 12px face in a 16px box has 4". Every term in
  the span is linear in em, so the requirement is scale-invariant and a *ratio*
  is exactly the right unit. That reasoning was the direct cause of the worst
  symptom: the profile screen's name is `type="heading"` at 20/28 = 1.40,
  exempt, and in Sarabun it lost most of its below-baseline vowels.

Both are gone. Every emitted line height is clamped, including the role
table's own.

**Attempt 2 — measured, but over the wrong basis.** The formula added the
declared box as a third term and the script scanned Latin Extended-A for every
family. The numbers were reproducible and still wrong for two of four
families, for the reasons in "What it does *not* do". Reproducibility is not
the same as measuring the right thing.

#### What it costs, at the medium rung

| role | table | noto | looped | sarabun |
| --- | --- | --- | --- | --- |
| `caption` | 12/18 | 12/**18** | 12/19 | 12/19 |
| `body` | 15/22 | 15/**22** | 15/24 | 16/25 |
| `default` | 16/24 | 16/**24** | 16/25 | 17/27 |
| `heading` | 20/28 | 20/**28** | 20/31 | 21/33 |
| `title` | 24/32 | 24/**32** | 24/38 | 25/39 |

**Noto is unchanged, at every rung and every role**, and so is the `mono`
blood-pressure figure. Only a user who has opted into looped or Sarabun pays
anything. The tab bar gains 3px under looped and 4px under Sarabun, and
nothing under Noto.

#### The `__DEV__` warning fires on intent, not on arithmetic

It is measured against `DEFAULT_LINE_HEIGHT_RATIO` (1.45), **not** against the
family floor. A role's line height being under a family's floor is routine —
the type scale is family-agnostic by design and adapting it is the resolver's
job — and an override like the composer's 24-over-16 is an ordinary 1.5 that
happens to sit a hair under Noto's 1.52. Warning on either would fire on half
the app the moment someone picks a non-default face, and a warning that cries
wolf gets muted. What is left is the real signal: a caller deliberately
tightening a line box, like the `lineHeight={16}` against a 12px `caption`
that clipped on hardware.

#### Adding or upgrading a family

1. Add its files to `FAMILIES` in `scripts/font-metrics.mjs`, **with a `scan`
   range covering the glyphs this app will actually hand it.** A face used for
   one purpose gets the code points of that purpose, not a blanket range.
2. Run `node scripts/font-metrics.mjs` and paste both ratios.
3. Update the literals in `theme/typography.test.ts`, which pins them.

Do not hand-pick the numbers — that is what produced 1.45.

### Weight falls outward on a two-weight family

`resolveFamilyWeight` maps `medium → regular` and `semibold → bold` rather than
collapsing both onto regular. Those two rungs are what separates a card's title
from its subtitle; collapsing them would flatten that hierarchy on every
settings-shaped and card-shaped screen in the app.

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

3. **Every font name in `FONT_FAMILIES` must be loaded in `_layout.tsx`.** An
   unloaded family name does not throw — it silently falls back to the system
   font, which is a different Thai face per OEM and the reason the app bundles
   one. `theme/typography.test.ts` pins the two lists together, in both
   directions: a name nothing loads fails, and a font loaded that nothing names
   fails too (dead weight in a phone bundle is paid for at install time).

   The runtime guard is separate and equally load-bearing: since the non-Noto
   families load *after* first paint, "named but not yet loaded" is a normal
   state rather than a coding mistake, and `use-typography.ts` returns Noto
   until the real family lands.

---

## 1. `className` on a `ThemedText` is layout only — colour, size, and family fail silently

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

- **`font-bold` / `font-semibold` are the same trap in the weight axis**, and
  the migration hit it: `text-field.tsx`, the two health-form textareas, the
  chart's pointer label, and the tab bar were all pairing a `fontWeight` class
  with what is now an explicit `fontFamily`. On Android a `fontWeight` beside a
  named family is ignored or synthesised into a fake bold. Those classes were
  moved onto the resolver's `weight`, which selects a font *file*.

**Worth doing:** an ESLint rule banning `text-white`, `text-[…]`,
`text-sm`-family, and `font-*`-weight classes on `ThemedText` and on any style
built from `useTypography()`. It is the only mechanical guard against a trap
whose failure mode is invisible in review.

**The machinery for it now exists.** `client/eslint-rules/` holds
project-owned rules and `eslint.config.js` wires them under a `bp/` prefix; the
first one is `bp/mono-family-latin-only` (below). A className rule is the same
shape — read `className` off a `JSXAttribute`, match the literal against a
deny-list — and would slot in beside it. It is deliberately **not** written
yet: the deny-list is a design decision (does `text-center` stay? every layout
class does, so the list has to enumerate the failing families rather than
allow-list), and bundling it with the `mono` rule would have made one change
answer two questions.

### The `mono` content rule

`bp/mono-family-latin-only`
([`client/eslint-rules/mono-family-latin-only.js`](../../client/eslint-rules/mono-family-latin-only.js))
errors when a `family="mono"` node is given literal text outside digits, `/`,
and whitespace.

The trap it closes: `mono`'s `minLineHeightRatio` of 1.03 is measured over
**only the glyphs it is locked to**, via the per-family `scan` range in
`scripts/font-metrics.mjs`. Put a letter in a `mono` node and the floor
silently stops covering it — and the face is Latin-only besides, so Thai falls
back to the OEM system font. `theme/typography.ts` said so in a comment; this
is the guard.

**What it cannot see**, stated here because the limitation is permanent rather
than a gap to close later:

| written as | caught |
| --- | --- |
| `<T family="mono">mmHg</T>` | yes |
| `` <T family="mono">{`${sys} mmHg`}</T> `` | yes — the literal part only |
| `<T family="mono">{'ความดัน'}</T>` | yes |
| `<T family="mono">{reading.systolic}</T>` | **no** — dynamic |
| `<T family="mono">{unitLabel}</T>` | **no** — dynamic, even if the constant is Thai |
| `<T family={id}>ความดัน</T>` | **no** — the family is dynamic |
| `typographyFor(prefs, { family: 'mono' })` | **no** — not JSX |

All nine `family="mono"` call sites in the app today are the dynamic form, so
**the rule flags nothing on the current tree**. That is the intended state: it
guards the next edit, not this one. Chasing the dynamic cases means following
identifiers across modules, and a rule that guesses produces false positives
under `--max-warnings 0`, where every false positive is a failed build. A Thai
string arriving through a variable remains a review concern.

Widening the allowed set is not a one-line change: add the code points to the
family's `scan` range in `scripts/font-metrics.mjs`, re-run it, paste the new
ratio into `FONT_FAMILIES`, update `theme/typography.test.ts`, and then widen
`ALLOWED` in the rule — in that order, in one change.

---

## 2. A `lineHeight` or `fontSize` in `style` is not scaled

The variant's numbers go through the multiplier; a literal in `style` does
not. It looks correct on a dev device at default settings and silently stops
tracking the preference. This is why `size` and `lineHeight` are **props**
rather than something you pass through `style`.

---

## 3. The scale — closed

**There was not a scale, and now there is one.** The roles in `TYPE_SCALE`
arrived as the sizes the app already used, given role names. That was the right
move to get the typeface applied without redesigning anything, and it was not a
scale: twelve roles, four of which sat one pixel from a neighbour, and an
escape hatch carrying two heading sizes and three sizes of the same number.

**The decision was taken by the project owner and executed on
`refactor/type-scale-consolidation`.** It is recorded here as closed. The
answers to (a)–(c) were, in every case, **subtraction** — the scale got smaller,
not more expressive, and no surviving role's `fontSize` moved.

### (a) Headings collapse to one size — `heading` (20)

Section and screen headings rendered at `size={18}` and at `type="heading"`
(20). Two heading sizes one step apart is the accident pattern.

**Every heading-role `size={18}` and `size={19}` node folded into
`type="heading"`.** Headings got 2px larger, deliberately: the audience is
elderly patients, and a heading being too big is a smaller failure than one
being too small.

`size={19}` was folded too, and the doc's old description of those nodes as
"prose headings" did not survive reading them. Three of the four
(`about.tsx:73`, `help.tsx:72`, `health-tips.tsx:51`) are `flex-1 text-center`
titles in a back-button header row — the same role the gradient
`ScreenHeaderPill` plays on the tab screens, drawn a different way. The fourth
(`about.tsx:95`) is the app's own name under the heart glyph on the about card.
None of them is prose; 19 was simply where three copies of one header row
landed.

**Not every `size={18}` was a heading, and this is the trap the change had to
avoid.** 45 nodes in `client/src` matched `size={18}` or `size={19}`. Only 15
were `ThemedText`:

| what | nodes | outcome |
| --- | --- | --- |
| `ThemedText` section / screen headings | 15 | → `type="heading"` |
| `Ionicons` (and other icon) `size` props | 28 | untouched — a different prop on a different component |
| Prose inside `screen-header-pill.tsx`'s own header comment | 2 | rewritten |

Converting an icon would have been silent; converting a non-heading `ThemedText`
would have changed its **weight** as well as its size, because the role carries
`weight: 'semibold'`. Weight was therefore preserved node-by-node rather than
inherited: the eleven `weight="bold"` headings kept `weight="bold"`, and the
three that were already `weight="semibold"` dropped the now-redundant prop. The
only thing that changed is the size.

`ScreenHeaderPill` (added in #116) owned three of the fifteen in one place, which
is why consolidating it first was worth doing before answering this.

### (b) The blood-pressure figure drops from three sizes to two

It rendered at 48 (home hero card), 44 (reading detail, as `type="display"`),
and 38 (history row). Each was defensible on its own; the set was not, because
nobody chose 38 as "one step below 44".

**Two sizes: 48 on the hero, 38 everywhere else.** The detail screen's figure
came down from 44 to 38 and joined the list rows.

Two consequences fall out of that, and both close accidents rather than create
them:

- **`display` (44) is gone from `TYPE_SCALE`.** Its only two nodes were the
  detail screen's digits. The figure is one component's composition — 48 on a
  hero, 38 in a row — which is exactly what `ThemedText`'s `size` prop is
  documented to be for. Naming it a *role* is what let the detail screen drift
  to a third size in the first place: a role's line height comes from the table
  while a `size={n}`'s comes from `size × DEFAULT_LINE_HEIGHT_RATIO`, so the two
  surfaces were reaching the resolver by different routes and could not be
  compared by reading them.
- **The `size={36}` slash is gone.** The detail screen was the only surface
  whose slash was a different size from its digits — the hero and the history
  row have always used one size for all three glyphs. It now does too. The
  `flex-row items-end` pairing that #114 had to fix by hand is now **structural**:
  digits and slash share one spec, so their line boxes cannot diverge. The
  hand-maintained equality assertion in `use-typography.test.ts` was replaced by
  one that holds at every font-size rung.

All three surfaces keep `family="mono"`. That is load-bearing for column
alignment, and `mono`'s line-height floor is measured against digits and `/`
only.

### (c) The body band becomes a real ratio scale

`body` 15 / `small` 14 / `label` 13 were ~190 nodes sitting one pixel apart. At
the `small` font-size rung they rounded to 12 / 12 / 11 and the hierarchy
stopped existing — for exactly the users who chose the smallest text.

**The band is now `label` 13 / `body` 15 / `bodyLarge` 17**, and it got there by
deleting the 14 rung rather than by moving anything:

| role | before | after |
| --- | --- | --- |
| `label` | 13 | 13 — unchanged |
| `small` | 14 | **gone** — 58 nodes folded into `body` |
| `body` | 15 | 15 — unchanged |
| `bodyLarge` | 17 | 17 — unchanged |

`theme/typography.test.ts` now pins the ≥2px gap between the rungs, so the band
cannot silently re-collapse.

**`smallBold` (14, bold) did not survive alone.** It was `small`'s weight
variant, and once `small` folded there was nothing for it to be a variant of.
Its two call sites (`components/ui/option-row.tsx`,
`modules/readings/components/bp-trend-chart.tsx`) are now
`type="body" weight="bold"` — which is what the `weight` prop exists for, and
which does not need a role of its own.

**`link` (14) is gone too.** It had zero call sites in the app and named a rung
that no longer exists. A link is a colour decision more than a size one; when
the app grows a real one, it gets a role chosen for that rather than this
leftover. `type="link"` is now a type error, which is the right way for the next
author to find this paragraph.

### `TYPE_SCALE`, before and after

Line heights were checked against the rule that broke twice before (§5.0): a
size change carrying a stale line height either fails the Thai-safe leading
assertion or silently tightens the leading. **No surviving role's `fontSize`
moved**, so every `lineHeight` below is still the one chosen against its own
size, and no recomputation was owed.

| role | before (px / lh / ratio) | after | note |
| --- | --- | --- | --- |
| `display` | 44 / 52 / 1.182 | **removed** | the detail screen's BP figure; now `size={38}` |
| `title` | 24 / 32 / 1.333 | 24 / 32 / 1.333 | unchanged — now the tightest ratio in the table |
| `heading` | 20 / 28 / 1.400 | 20 / 28 / 1.400 | unchanged size; gained 15 nodes from (a) |
| `bodyLarge` | 17 / 25 / 1.471 | 17 / 25 / 1.471 | unchanged |
| `default` | 16 / 24 / 1.500 | 16 / 24 / 1.500 | unchanged — pinned to `BASELINE_PX` |
| `body` | 15 / 22 / 1.467 | 15 / 22 / 1.467 | unchanged size; gained 58 nodes from `small` |
| `small` | 14 / 21 / 1.500 | **removed** | → `body` |
| `smallBold` | 14 / 21 / 1.500 | **removed** | → `body` + `weight="bold"` |
| `label` | 13 / 19 / 1.462 | 13 / 19 / 1.462 | unchanged |
| `caption` | 12 / 18 / 1.500 | 12 / 18 / 1.500 | unchanged |
| `link` | 14 / 21 / 1.500 | **removed** | no call sites |
| `code` | 12 / 18 / 1.500 | 12 / 18 / 1.500 | unchanged |

Twelve roles to eight. Noto's floor (1.15) is still cleared by every one of
them, so the acceptance criterion for the whole line-height mechanism — a Noto
user sees no pixel change from it — is intact; the lowest ratio in the table is
now `title` at 1.333 rather than `display` at 1.182.

### What this did *not* close

**`body` 15 / `default` 16 / `bodyLarge` 17 are still three roles one pixel
apart**, and together they are ~200 nodes. That is the same shape of problem
(c) was about, and it is flagged rather than fixed: `default` is 16 because 16
is `BASELINE_PX`, the number the setup screen previews as the medium rung, so
unpicking it is a change to the size ladder and not to the role scale. It wants
its own decision, taken with §5's device pass, and it is **not** an invitation
to nudge one of the three by a pixel.

### Variant use after the change

| variant | px | uses |
| --- | --- | --- |
| `body` | 15 | 154 |
| `label` | 13 | 60 |
| `caption` | 12 | 39 |
| `default` | 16 | 28 explicit + the implicit default |
| `heading` | 20 | 25 |
| `bodyLarge` | 17 | 16 |
| `title` | 24 | 3 |
| `code` | 12 | 2 |

And `size={n}` — the escape hatch, and the inventory of what the scale
deliberately does not name. `grep -E '<ThemedText[^>]*size=\{[0-9]+\}' client/src`
gives it, excluding `themed-text.test.tsx`'s own fixtures:

| size | uses | what |
| --- | --- | --- |
| 48 | 3 | the blood-pressure figure on the home hero card |
| 38 | 6 | the blood-pressure figure — a history row (3) and the detail screen (3) |
| 28 / 26 / 22 | 1 each | auth hero, onboarding hero, app-lock gate |
| 11 | 1 | one caption on home |
| `SIZE_FONT[size]`, `INITIALS_FONT[size]` | 1 each | a button's own size prop; avatar initials |

18, 19, and 36 are gone from this table entirely. What is left is two kinds of
thing, and both are the prop working as designed: a component whose text size is
a property of the component (the BP figure, a button's own `size`, avatar
initials), and four one-off hero sizes on screens that have no siblings to be
consistent with.

**Do not re-answer this by adding variants one at a time.** That is how the
original twelve came to exist. A fourth heading size showing up is evidence
against the screen that wants it, not a request for `headingSmaller`.

### Still owed: eyes

This is a visual change across roughly 200 nodes and **nobody has looked at it
on a device or in a simulator.** §5 was already the gate on this file; it is now
the gate on this section too. The screens most likely to be wrong, in order, are
listed at the end of §5.

---

## 4. The six raw `<Text>` that stay

Not oversights. Each would be wrong to convert.

| Where | Why |
| --- | --- |
| `components/ui/font-size-picker.tsx` (3) | The preview of each font-size option, and the sample paragraph under it. The four samples must **not** scale with the current preference — they show what each setting looks like, so scaling them would make the control preview itself. They go through `usePreviewTypography()` with **that option's** values; the labels and the sample paragraph use `useTypography()`, deliberately. |
| `components/ui/font-family-picker.tsx` (1) | Same rule, other axis: each card's sample renders in **that card's** face via `usePreviewTypography()`, not in the currently selected one. |
| `modules/readings/components/bp-trend-chart.tsx` (1) | `axisFontSize + 1`, pinned to a prop handed to the chart library. The pointer label reading one step larger than the axis it floats over is the point. |
| `modules/community/components/post-card.tsx` (1) | Uses `onTextLayout` with a dynamic `numberOfLines` to decide whether to offer "อ่านต่อ". |

`app/onboarding/setup.tsx` no longer appears in this table. It used to carry
its own `PREVIEW_SIZE`, `FONT_LABELS`, and `THEMES` and had already drifted
from settings — it called the medium rung `ปกติ` where the picker says
`มาตรฐาน`. It now renders the same `SettingCard` + `ThemePicker` /
`FontSizePicker` / `FontFamilyPicker` that `app/settings.tsx` does, so there is
nothing left to drift.

Reaching for `useTypography()` in either picker breaks it: the control would
preview whatever is already selected instead of each option. Reaching for
`typographyFor()` breaks it the other way — that is dp, a `style` prop is style
space, and the OS accessibility scale compounds. `usePreviewTypography()` is
the one that is both. The chart and the
post card break a visual hierarchy and a "read more" affordance respectively,
neither of which any test covers — both keep their literal relationships and
take only the family and the multiplier from the resolver.

---

## 5. Nothing has run on a device, and here that matters most

This changed the typeface and the line height of every screen. The specific
things a device pass has to look at, in order of how likely they are to be
wrong:

0. **Thai diacritic clipping — two device passes, two rounds of fixes.**

   **Round 1** found it in the history filter row, which passed
   `lineHeight={16}` against a 12px `caption` (1.33). Fixed with a flat 1.45
   floor. **That fix was incomplete**, and the second pass proved it.

   **Round 2** found ◌ุ / ◌ู still clipped under looped (~20 %) and Sarabun
   (~70 %) in the bottom tab labels and the profile name, with Noto fine in
   both. Two distinct causes — see the table in "The Thai line-box floor". The
   floor is now per-family and measured off the font binaries, the exemption
   for the display roles is gone, and the tab bar sizes itself from the
   selected family's natural box.

   **Still to confirm on a device**, and this is now the top of the list
   because the fix is the thing that has not been seen:

   - The **same two surfaces** — bottom tab labels and the profile screen's
     name — in **looped and Sarabun**, at every font-size rung. This is the
     direct retest.
   - `เสื้อ`, `ผู้`, `ที่`, `ฐาน`, `ญ` at `heading` and at `xlarge` in all
     three families. The floors are derived from the deepest glyph in the Thai
     block, so if anything still clips the measurement is right and something
     downstream is overriding it.
   - **Any screen at a raised *system* font size**, in looped or Sarabun. This
     is where the unit-space defect above lived, and it is invisible at the
     default OS scale. Set Android's font size to Large or Largest, then walk
     the tab bar and the history filter pills at each in-app rung.
   - Anywhere text sits in a **fixed-height** container. `lineHeight: null`
     sites are still outside the floor by design, and the tab bar was the only
     one found by reading. Row heights, badges, and pills are where another
     would hide.
   - That Noto is **unchanged**. Its body text moved by one pixel; if anything
     looks different on the default family, the floor is being applied where
     it should not be.

0b. **The three `opticalScale` values.** `looped` 1.02, `sarabun` 1.04, `mono`
   0.96 are estimates read off font metrics, not measurements. Put the same
   paragraph in each family side by side at `body` and at `heading` and adjust
   until they read as equal weight on the page. Until someone does, treat these
   numbers as unverified.

0c. **The deferred-font FOUT.** Cold-start with `looped` or `sarabun`
   selected and watch the swap. It should be Noto → the chosen face, never
   Noto → OEM face → the chosen face. If you see three states,
   `font-loading.tsx` is not being consulted somewhere.

0d. **The blood-pressure figure in `mono`.** Home hero, history row, detail
   screen: `120/80` and `148/92` must occupy the same width, and the digits
   must not read as noticeably larger or smaller than the Thai around them.
   **It must not move at all during launch** — mono blocks the splash for
   exactly this reason. Digits that resize a beat after the home screen paints
   mean it slipped back into the deferred set.

0e. **The history filter row and the font-size picker at every rung.** These
   are the two call sites whose line heights changed. The pills are 4px taller
   at medium; confirm the two-line labels still fit at `xlarge` and that the
   picker's four cards are still equal height.

1. **Thai diacritic clipping at the largest font-size rung.** Words like
   `เสื้อ`, `ที่`, `ผู้` in a `heading` at `xlarge`. Clipping means the ratio
   is still too tight.
2. **A device with a non-default system font size.** Set Android's font size
   to Large, then walk the app at each of the four in-app steps. The rendered
   size must depend only on the in-app setting. If text grows twice, the OS
   compensation in `useFontScale` has been undone.
3. **The whole app at `xlarge`.** Row heights, `numberOfLines={1}` truncation,
   the two-line pill in `tab-buttons`, buttons whose label now wraps.
4. **Every screen once, at default, just to look at it.** A typeface change is
   the definition of something that passes tests and looks wrong.

### 5a. What §3 changed, ranked by how likely it is to look wrong

The scale consolidation is a visual change across roughly 200 nodes and nobody
has seen any of it. These are ordered by *what could look broken*, not by how
many nodes moved — the biggest node counts are the safest, because a uniform
one-pixel lift has nothing to look wrong against.

1. **Reading detail — `app/reading/[id].tsx`.** The only screen where the
   figure got **smaller**, 44 → 38, and it lost 6px inside a card whose padding
   did not change. Look for the figure now sitting in too much space, and for
   `mmHg` (`type="body"`, `mb-2 ml-2`) hanging at the wrong height beside it:
   the `flex-row items-end` baseline moved and `mmHg`'s manual offset did not.
   Cross-check the digits against a history row on the previous screen — they
   are now the same size and should read as the same figure, not as a coincidence.
2. **Home — `app/(tabs)/index.tsx`.** Two `size={18}` section headings became
   20 directly above a `size={48}` hero figure that did **not** move. The gap
   between heading and hero narrowed by 2px of type with no spacing change, and
   this is the app's primary screen. Also carries the app's one `size={11}`
   caption, now further from `label` (13) than it was from `small` (14).
3. **Card-dense list screens — history rows, caregivers, community.** This is
   where the 58 `small` → `body` nodes concentrate, and where the failure mode
   is not "too big" but "the hierarchy inverted". A card whose title is
   `type="body"` and whose subtitle *was* `small` now has both at 15, separated
   only by weight. Look at `link-row.tsx`, `person-card.tsx`, and
   `post-card.tsx` specifically: those pair a `type="default"` (16) name with a
   former-`small` line directly under it, so the pair is now 16 over 15.
4. **The three gradient tab header pills — `ScreenHeaderPill`.** One edit, three
   screens, 18 → 20 inside a `rounded-xl px-6 py-2.5` pill whose padding is
   fixed. Confirm the longest title (`ประวัติความดัน`) still fits on one line at
   the `xlarge` rung, and that the pill has not outgrown its own vertical
   padding.
5. **`app/about.tsx`, `help.tsx`, `health-tips.tsx`.** Back-button header rows
   where a `flex-1 text-center` title went 19 → 20 next to a fixed `size={28}`
   `arrow-back` glyph. The title is now only 8px smaller than the icon beside
   it; check the row still reads as a header rather than as two competing
   elements.
6. **Auth — `(auth)/onboarding-phone.tsx`, `(auth)/verify-email.tsx`.** These
   went 18 semibold → 20 semibold inside `AuthShell`, which has its own
   `size={28}` hero. Two nodes on `verify-email` are 6px apart now instead of 10.
7. **`option-row.tsx` and `bp-trend-chart.tsx`** — the two former `smallBold`
   nodes, now `body` + bold. The chart's is a pill label on a coloured fill
   sized by its own padding, and the option row's is a segmented control with
   `flex-1` cells; both are places where one extra pixel of type can force a
   wrap that no test sees.

Everything else is a uniform `small` → `body` lift with no neighbour to clash
with, and is the low-risk bulk of the change.

---

## 5b. What the family preference changed that is not typography

Two side effects worth knowing about, because neither is obvious from the
diff:

- **Four `<TextInput>` and the tab-bar label now render in the app's typeface.**
  They previously had no `fontFamily` at all and were drawing in the OEM system
  font — visible on Android as an input whose text does not match the label
  above it. The resolver cannot emit a size without a family, so this came with
  the migration rather than being chosen separately. It is the right outcome;
  it is still a visual change to five surfaces.
- **`TextSpec.lineHeight` accepts `null`, meaning "emit none".** It exists for
  inputs: an explicit line height mis-centres the caret and clips descenders on
  Android, and the three single-line fields that were doing the arithmetic by
  hand had no line height for exactly that reason. Silently acquiring one
  during the migration would have been a layout regression dressed as a
  refactor.

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

If the goal is **finishing typography**: the design work is done — §3 is
closed and the scale is eight roles. What is left is §5, and it is now the only
thing standing between this work and being trustworthy: **nothing here has been
seen on hardware, and §3 changed the size of roughly 200 text nodes.** Start at
§5's ranked list, not at the code.

The one design question still open is the one §3 deliberately did not answer:
`body` 15 / `default` 16 / `bodyLarge` 17 are three roles a pixel apart, and
`default` is pinned to `BASELINE_PX`. See "What this did *not* close".

If the goal is **anything else**: this file is done for now and
[CLIENT-remaining.md](./CLIENT-remaining.md) has the rest.
