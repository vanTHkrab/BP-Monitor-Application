/**
 * `CATEGORY_TABS` — the adapter between the module's category list and the
 * shape `components/ui/tab-buttons.tsx` consumes.
 *
 * It replaced a bespoke `CategoryTabs` component that iterated
 * `POST_CATEGORIES` itself. The property worth keeping from that component's
 * deleted test is the one that made a fourth category free: **the list is
 * derived, not restated**, so adding a category to `POST_CATEGORIES` is still
 * the only edit needed. A hand-written array of three literals would pass a
 * render test and silently drop the fourth.
 *
 * The `key` naming is load-bearing too. `TabButtons` composes
 * `${testIDPrefix}-${tab.key}`, and both screens pass a prefix chosen so the
 * ids the a11y tree and the tests already use survive the swap.
 */
import { CATEGORY_TABS, POST_CATEGORIES, categoryLabel } from './categories';

describe('CATEGORY_TABS', () => {
  it('covers every declared category, in order', () => {
    expect(CATEGORY_TABS.map((tab) => tab.key)).toEqual([...POST_CATEGORIES]);
  });

  it('takes its labels from the same table the rest of the module reads', () => {
    // Not restated literals: a label edited in `LABELS` has to reach the tab
    // without anyone remembering this file exists.
    for (const tab of CATEGORY_TABS) {
      expect({ key: tab.key, label: tab.label }).toEqual({
        key: tab.key,
        label: categoryLabel(tab.key),
      });
    }
  });

  it('names the field TabButtons actually reads', () => {
    // `key`, not `value`. `TabButtons` keys, test-IDs, and `activeTab`
    // comparison all go through this field; a rename would render three tabs
    // with `undefined` ids and no selected state, and still render.
    for (const tab of CATEGORY_TABS) {
      expect(typeof tab.key).toBe('string');
      expect(tab.key.length).toBeGreaterThan(0);
    }
  });
});
