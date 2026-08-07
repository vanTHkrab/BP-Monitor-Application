/**
 * Collapsed is the state that matters, and it is not an interaction: the
 * children must be *absent* from the tree, not merely hidden. A `Collapsible`
 * that mounts its children while closed pays their render cost on every
 * screen that uses one, and — worse for this app — a collapsed section
 * holding a form field would put that field in the accessibility tree for a
 * screen reader with nothing on screen to explain it.
 */
import { Collapsible } from '@/components/ui/collapsible';
import { ThemedText } from '@/components/themed-text';
import { renderScreen } from '../test-utils';

describe('Collapsible', () => {
  it('renders its title', async () => {
    const view = await renderScreen(
      <Collapsible title="รายละเอียด">
        <ThemedText>เนื้อหา</ThemedText>
      </Collapsible>,
    );

    expect(view.getByText('รายละเอียด')).toBeOnTheScreen();
  });

  it('starts closed, with the children unmounted', async () => {
    const view = await renderScreen(
      <Collapsible title="รายละเอียด">
        <ThemedText>เนื้อหา</ThemedText>
      </Collapsible>,
    );

    expect(view.queryByText('เนื้อหา')).toBeNull();
  });
});
