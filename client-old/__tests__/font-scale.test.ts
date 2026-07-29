import {
  type FontSizePreference,
  fontPresetClass,
  getFontClass,
  getFontNumber,
} from "@/utils/font-scale";

describe("getFontClass", () => {
  const classes = {
    xsmall: "text-[10px]",
    small: "text-xs",
    medium: "text-base",
    large: "text-lg",
    xlarge: "text-xl",
  };

  it("resolves the 'small' option to the smallest declared rung (xsmall) when present", () => {
    // The smallest selectable preference must render the smallest declared
    // size — regression guard for the bug where 'small' rendered the mid-small
    // rung and the xsmall values were dead.
    expect(getFontClass("small", classes)).toBe("text-[10px]");
  });

  it("falls back to 'small' when no xsmall rung is declared", () => {
    const { xsmall: _xsmall, ...withoutXsmall } = classes;
    expect(getFontClass("small", withoutXsmall)).toBe("text-xs");
  });

  it("leaves medium / large / xlarge untouched", () => {
    expect(getFontClass("medium", classes)).toBe("text-base");
    expect(getFontClass("large", classes)).toBe("text-lg");
    expect(getFontClass("xlarge", classes)).toBe("text-xl");
  });

  it("falls back xlarge -> large when xlarge is omitted", () => {
    const { xlarge: _xlarge, ...withoutXlarge } = classes;
    expect(getFontClass("xlarge", withoutXlarge)).toBe("text-lg");
  });

  it("produces a strictly non-increasing size for 'small' vs the other rungs", () => {
    // small must never render larger than medium in any declared ladder.
    expect(getFontClass("small", classes)).not.toBe(
      getFontClass("medium", classes),
    );
  });
});

describe("getFontNumber", () => {
  const sizes = { xsmall: 10, small: 12, medium: 16, large: 18, xlarge: 20 };

  it("resolves 'small' to the xsmall rung when present", () => {
    expect(getFontNumber("small", sizes)).toBe(10);
  });

  it("falls back to 'small' when xsmall is absent", () => {
    const { xsmall: _xsmall, ...withoutXsmall } = sizes;
    expect(getFontNumber("small", withoutXsmall)).toBe(12);
  });

  it("keeps 'small' strictly below the standard 'medium' rung", () => {
    expect(getFontNumber("small", sizes)).toBeLessThan(
      getFontNumber("medium", sizes),
    );
  });
});

describe("fontPresetClass (every preset carries an xsmall rung)", () => {
  // Tailwind text class -> px, covering every rung any preset declares.
  const classPx: Record<string, number> = {
    "text-[10px]": 10,
    "text-[11px]": 11,
    "text-xs": 12,
    "text-[13px]": 13,
    "text-sm": 14,
    "text-[15px]": 15,
    "text-base": 16,
    "text-[17px]": 17,
    "text-lg": 18,
    "text-[19px]": 19,
    "text-xl": 20,
    "text-[21px]": 21,
    "text-[22px]": 22,
    "text-2xl": 24,
    "text-[28px]": 28,
    "text-[32px]": 32,
  };

  const px = (cls: string) => {
    const value = classPx[cls];
    if (value === undefined) {
      throw new Error(`Unmapped Tailwind text class in preset ladder: ${cls}`);
    }
    return value;
  };

  const tokenNames = Object.keys(fontPresetClass) as (keyof typeof fontPresetClass)[];

  it("resolves 'small' (เล็ก) strictly smaller than 'medium' (มาตรฐาน) for every token", () => {
    // The bug this guards: preset screens rendered their `small` value at the
    // "เล็ก" setting while raw components shrank to `xsmall`, so pages didn't
    // match and "เล็ก" didn't actually shrink. Now every token declares an
    // xsmall rung, so "small" must render visibly below "medium".
    for (const name of tokenNames) {
      const token = fontPresetClass[name];
      expect(px(token("small"))).toBeLessThan(px(token("medium")));
    }
  });

  it("resolves 'small' to a smaller class than the token's declared `small` value", () => {
    // Spot-check the two anchor tokens the previous contract pinned: they must
    // now shrink at "เล็ก" instead of staying put.
    expect(fontPresetClass.body("small")).toBe("text-[11px]");
    expect(fontPresetClass.title("small")).toBe("text-base");
  });

  it("keeps every token's ladder monotonic across all five rungs", () => {
    const rungs: FontSizePreference[] = [
      "small",
      "medium",
      "large",
      "xlarge",
    ];
    for (const name of tokenNames) {
      const token = fontPresetClass[name];
      // small resolves to xsmall (the smallest declared rung); each subsequent
      // rung must be strictly larger.
      for (let i = 1; i < rungs.length; i += 1) {
        expect(px(token(rungs[i - 1]))).toBeLessThan(px(token(rungs[i])));
      }
    }
  });

  it("never renders below the elderly-first readability floor (~10px)", () => {
    for (const name of tokenNames) {
      const token = fontPresetClass[name];
      expect(px(token("small"))).toBeGreaterThanOrEqual(10);
    }
  });
});
