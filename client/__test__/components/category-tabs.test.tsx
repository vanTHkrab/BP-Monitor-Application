/**
 * The feed's three category tabs. A presentational segmented row — the render
 * assertion and the selected state are the whole test, and inventing more
 * would be padding.
 *
 * The one thing worth taking from `lib/categories` rather than restating: the
 * tabs are driven by `POST_CATEGORIES`, so a fourth category added there must
 * appear here without a change to this component. Iterating the export is
 * what makes that true rather than hoped-for.
 */
import { CategoryTabs } from '@/modules/community/components/category-tabs';
import { POST_CATEGORIES, categoryLabel } from '@/modules/community/lib/categories';
import { renderScreen } from '../test-utils';

const noop = () => {};

describe('CategoryTabs', () => {
  it('renders a tab for every category the module declares', async () => {
    const view = await renderScreen(<CategoryTabs value="general" onChange={noop} />);

    for (const category of POST_CATEGORIES) {
      expect(view.getByTestId(`community-tab-${category}`)).toBeOnTheScreen();
      expect(view.getByText(categoryLabel(category))).toBeOnTheScreen();
    }
  });

  it('marks exactly the active category', async () => {
    const view = await renderScreen(<CategoryTabs value="qa" onChange={noop} />);

    expect(view.getByTestId('community-tab-qa')).toBeSelected();
    expect(view.getByTestId('community-tab-general')).not.toBeSelected();
    expect(view.getByTestId('community-tab-experience')).not.toBeSelected();
  });
});
