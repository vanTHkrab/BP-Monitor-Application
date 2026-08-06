/**
 * The content itself is not worth asserting line by line — a test that
 * re-types the Thai copy only proves the copy was typed twice. What is worth
 * asserting is the shape the screen relies on: stable unique keys, no empty
 * card, and an icon for every tip including ones this table has never seen.
 */
import { HEALTH_TIPS, resolveTipIcon } from './tips';

describe('HEALTH_TIPS', () => {
  it('carries the four tips ported from client-old', () => {
    expect(HEALTH_TIPS).toHaveLength(4);
  });

  it('has unique ids — they are the list keys', () => {
    const ids = HEALTH_TIPS.map((tip) => tip.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has non-empty title and description on every tip', () => {
    for (const tip of HEALTH_TIPS) {
      expect(tip.title.trim()).not.toBe('');
      expect(tip.description.trim()).not.toBe('');
    }
  });
});

describe('resolveTipIcon', () => {
  it('resolves a distinct icon for every bundled tip', () => {
    const names = HEALTH_TIPS.map((tip) => resolveTipIcon(tip.icon).name);
    expect(new Set(names).size).toBe(HEALTH_TIPS.length);
  });

  it('never returns the fallback for a bundled tip', () => {
    const fallback = resolveTipIcon('__no-such-key__');
    for (const tip of HEALTH_TIPS) {
      expect(resolveTipIcon(tip.icon)).not.toEqual(fallback);
    }
  });

  it('falls back rather than returning undefined for an unknown key', () => {
    const icon = resolveTipIcon('__no-such-key__');
    expect(icon.name).toBe('sparkles-outline');
    expect(icon.tint).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(icon.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
