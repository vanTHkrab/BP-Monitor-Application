/**
 * The full-bleed screen background. It has exactly one branch — `safeArea`,
 * which is off for a screen that manages its own insets, currently the
 * full-bleed camera.
 *
 * Getting it inverted is a bug that only shows on a notched device: the
 * camera preview slides down under the status bar, or every other screen
 * loses its top inset and puts its heading behind the clock. Neither is
 * visible in a simulator run at the default device, and neither changes any
 * text.
 *
 * The padding is reached through the style prop because there is genuinely
 * nothing else — no role, no label, no text differs between the two states.
 */
import { View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { ThemedText } from '@/components/themed-text';
import { renderScreen } from '../test-utils';
import { findHostNodes, type RenderedNode } from './host-tree';

/**
 * `test-utils` seeds `SafeAreaProvider` with a notched phone's metrics
 * (top 47, bottom 34) rather than zeroes, which is what makes "did it apply
 * the insets" answerable at all — against zeroed metrics both branches render
 * identically and the test would pass forever.
 */
const insetsOf = (tree: RenderedNode) =>
  findHostNodes(tree, 'View')
    .map((node) => node.props?.style as Record<string, number> | undefined)
    .find((style) => style?.paddingTop !== undefined);

describe('GradientBackground', () => {
  it('renders its children', async () => {
    const view = await renderScreen(
      <GradientBackground>
        <ThemedText>เนื้อหา</ThemedText>
      </GradientBackground>,
    );

    expect(view.getByText('เนื้อหา')).toBeOnTheScreen();
  });

  it('spends the safe-area insets by default', async () => {
    const view = await renderScreen(
      <GradientBackground>
        <View testID="body" />
      </GradientBackground>,
    );

    expect(insetsOf(view.toJSON() as RenderedNode)).toEqual({
      paddingTop: 47,
      paddingBottom: 34,
      paddingLeft: 0,
      paddingRight: 0,
    });
  });

  // The camera's case: a preview that stopped at the notch would letterbox
  // the frame the on-device detector is checking.
  it('spends none when the screen manages its own', async () => {
    const view = await renderScreen(
      <GradientBackground safeArea={false}>
        <View testID="body" />
      </GradientBackground>,
    );

    expect(insetsOf(view.toJSON() as RenderedNode)).toBeUndefined();
  });
});
