/**
 * The tab bar button. It is a pass-through wrapper, and that is precisely
 * what makes it worth a test: React Navigation hands it eight props and it
 * re-lists every one by hand. A dropped `accessibilityState` is how the tab
 * bar stops announcing which tab is current — the app's only navigation
 * affordance going silent for a screen-reader user, with nothing visibly
 * wrong.
 *
 * The haptic itself is not asserted. It fires only on iOS via
 * `process.env.EXPO_OS` and only on press-in, which is an interaction; this
 * batch writes none.
 */
import { Text } from 'react-native';
import type { BottomTabBarButtonProps } from 'expo-router/js-tabs';

import { HapticTab } from '@/components/haptic-tab';
import { renderScreen } from '../test-utils';

const noop = () => {};

/** Only the props the component actually forwards; the rest are navigator internals. */
const props = (overrides: Partial<BottomTabBarButtonProps> = {}) =>
  ({
    accessibilityLabel: 'หน้าหลัก',
    accessibilityRole: 'button',
    accessibilityState: { selected: true },
    testID: 'tab-home',
    onPress: noop,
    onLongPress: noop,
    children: <Text>หน้าหลัก</Text>,
    ...overrides,
  }) as unknown as BottomTabBarButtonProps;

describe('HapticTab', () => {
  it('renders the tab content it is handed', async () => {
    const view = await renderScreen(<HapticTab {...props()} />);

    expect(view.getByText('หน้าหลัก')).toBeOnTheScreen();
  });

  // The one that matters: this is how the tab bar says "you are here".
  it('forwards the selected state', async () => {
    const view = await renderScreen(<HapticTab {...props()} />);

    expect(view.getByTestId('tab-home')).toBeSelected();
  });

  it('forwards the unselected state too', async () => {
    const view = await renderScreen(
      <HapticTab {...props({ accessibilityState: { selected: false } })} />,
    );

    expect(view.getByTestId('tab-home')).not.toBeSelected();
  });

  it('forwards the label and the role', async () => {
    const view = await renderScreen(<HapticTab {...props()} />);

    expect(view.getByRole('button', { name: 'หน้าหลัก' })).toBeOnTheScreen();
  });
});
