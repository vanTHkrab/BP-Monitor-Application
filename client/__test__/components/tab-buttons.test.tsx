/**
 * The pill filter row. Two things here are load-bearing and neither is
 * visible in a screenshot.
 *
 * `accessibilityLabel` overrides the visible label for screen readers, and it
 * exists for grouped filters — "เฝ้าระวัง" covers three BP statuses and does
 * not say so. A screen-reader user has no colour tint to infer it from, so
 * dropping that prop silently makes the filter unreadable to exactly the
 * users this app is built for.
 *
 * The active pill also renders through a different branch (a gradient) than
 * the inactive one (a plain View), so "which one is selected" is a structural
 * question, not a style one.
 */
import { TabButtons } from '@/components/ui/tab-buttons';
import { renderScreen } from '../test-utils';

const TABS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'watch', label: 'เฝ้าระวัง', accessibilityLabel: 'เฝ้าระวัง สูงกว่าปกติ สูง และอันตราย' },
  { key: 'normal', label: 'ปกติ' },
] as const;

const noop = () => {};

describe('TabButtons', () => {
  it('renders every tab label', async () => {
    const view = await renderScreen(
      <TabButtons tabs={TABS} activeTab="all" onTabChange={noop} />,
    );

    for (const tab of TABS) {
      expect(view.getByText(tab.label)).toBeOnTheScreen();
    }
  });

  it('marks exactly the active tab as selected', async () => {
    const view = await renderScreen(
      <TabButtons tabs={TABS} activeTab="watch" onTabChange={noop} />,
    );

    expect(view.getByTestId('tab-watch')).toBeSelected();
    // The negatives are the half that matters: a `selected` computed with a
    // truthy test rather than an equality would light all three.
    expect(view.getByTestId('tab-all')).not.toBeSelected();
    expect(view.getByTestId('tab-normal')).not.toBeSelected();
  });

  // The grouped filter's whole accessibility story.
  it('announces the spelled-out label where a tab has one', async () => {
    const view = await renderScreen(
      <TabButtons tabs={TABS} activeTab="all" onTabChange={noop} />,
    );

    expect(view.getByTestId('tab-watch')).toHaveProp(
      'accessibilityLabel',
      'เฝ้าระวัง สูงกว่าปกติ สูง และอันตราย',
    );
  });

  // Undefined, not the visible label copied in: RN falls back to the child
  // text on its own, and duplicating it here would be the thing that drifts.
  it('leaves the label alone where a tab does not', async () => {
    const view = await renderScreen(
      <TabButtons tabs={TABS} activeTab="all" onTabChange={noop} />,
    );

    // Read off `props` rather than through `toHaveProp`: that matcher treats
    // an absent prop as a failure even when `undefined` is the expectation,
    // and absent is exactly what is being asserted.
    expect(view.getByTestId('tab-all').props.accessibilityLabel).toBeUndefined();
  });

  it('namespaces its testIDs so two rows on one screen do not collide', async () => {
    const view = await renderScreen(
      <TabButtons tabs={TABS} activeTab="all" onTabChange={noop} testIDPrefix="severity" />,
    );

    expect(view.getByTestId('severity-all')).toBeOnTheScreen();
    expect(view.queryByTestId('tab-all')).toBeNull();
  });

  /*
   * The height floor is the reason the component reads `useFontScale` at all:
   * at the largest rung a two-line label needs more than 44dp, and a pill
   * that clips its own text makes the elderly-first font setting actively
   * harmful. Reached through the style prop because there is nothing a query
   * can see.
   */
  it('keeps every pill at or above the 44dp tap floor', async () => {
    const view = await renderScreen(
      <TabButtons tabs={TABS} activeTab="all" onTabChange={noop} />,
    );

    for (const tab of TABS) {
      expect(view.getByTestId(`tab-${tab.key}`).props.style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });
});
