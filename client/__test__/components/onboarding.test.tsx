/**
 * The two onboarding building blocks, together because neither is more than
 * a handful of branches and they are only ever used with each other.
 *
 * `ChoiceCard`'s accessible name is `${title}. ${description}` — the
 * description is what makes "ผู้ป่วย" vs "ผู้ดูแล" a decision someone can
 * actually make, and for a screen-reader user it is the *only* thing that
 * does. This is the first screen of the app and the choice is not easily
 * undone, so the label is not decoration.
 *
 * `OnboardingShell`'s progress dots are `Array.from({ length: totalSteps })`
 * filled by `index < step`. Off-by-one there either shows step 1 as complete
 * before anything happened or never fills the last one.
 */
import { ThemedText } from '@/components/themed-text';
import { ChoiceCard } from '@/modules/onboarding/components/choice-card';
import { OnboardingShell } from '@/modules/onboarding/components/onboarding-shell';
import { renderScreen } from '../test-utils';
import { findHostNodes, type RenderedNode } from './host-tree';

const noop = () => {};

describe('ChoiceCard', () => {
  it('renders the title and the explanation', async () => {
    const view = await renderScreen(
      <ChoiceCard
        title="ผู้ป่วย"
        description="ฉันวัดความดันของตัวเอง"
        icon="person"
        selected={false}
        onPress={noop}
        testID="role-patient"
      />,
    );

    expect(view.getByText('ผู้ป่วย')).toBeOnTheScreen();
    expect(view.getByText('ฉันวัดความดันของตัวเอง')).toBeOnTheScreen();
  });

  it('speaks the explanation as part of the choice', async () => {
    const view = await renderScreen(
      <ChoiceCard
        title="ผู้ป่วย"
        description="ฉันวัดความดันของตัวเอง"
        icon="person"
        selected={false}
        onPress={noop}
        testID="role-patient"
      />,
    );

    expect(view.getByTestId('role-patient')).toHaveProp(
      'accessibilityLabel',
      'ผู้ป่วย. ฉันวัดความดันของตัวเอง',
    );
  });

  it('reports its selected state both ways', async () => {
    const selected = await renderScreen(
      <ChoiceCard title="ผู้ป่วย" description="d" icon="person" selected onPress={noop} testID="c" />,
    );
    expect(selected.getByTestId('c')).toBeSelected();

    const unselected = await renderScreen(
      <ChoiceCard title="ผู้ป่วย" description="d" icon="person" selected={false} onPress={noop} testID="c" />,
    );
    expect(unselected.getByTestId('c')).not.toBeSelected();
  });

  /*
   * The checkmark is the one non-colour cue that a card is chosen. On an
   * elderly-first flow where the border and fill shift is subtle, dropping it
   * leaves the selection readable only to someone who can compare two hues.
   */
  it('adds a checkmark only when chosen', async () => {
    const glyphs = async (selected: boolean) => {
      const view = await renderScreen(
        <ChoiceCard title="ผู้ป่วย" description="d" icon="person" selected={selected} onPress={noop} testID="c" />,
      );
      return view.getAllByText(/./).length;
    };

    expect(await glyphs(true)).toBe((await glyphs(false)) + 1);
  });
});

describe('OnboardingShell', () => {
  const shell = (props: Partial<React.ComponentProps<typeof OnboardingShell>> = {}) => (
    <OnboardingShell
      step={1}
      totalSteps={3}
      title="คุณคือใคร"
      subtitle="เลือกบทบาทของคุณ"
      actionTitle="ถัดไป"
      onAction={noop}
      actionTestID="next"
      {...props}
    >
      <ThemedText>เนื้อหา</ThemedText>
    </OnboardingShell>
  );

  it('renders the heading, the body, and the pinned action', async () => {
    const view = await renderScreen(shell());

    expect(view.getByText('คุณคือใคร')).toBeOnTheScreen();
    expect(view.getByText('เลือกบทบาทของคุณ')).toBeOnTheScreen();
    expect(view.getByText('เนื้อหา')).toBeOnTheScreen();
    expect(view.getByTestId('next')).toHaveTextContent('ถัดไป');
  });

  /*
   * The dots have no text, no role, and no testID — their fill is all there
   * is. Note what is *not* available: `h-1.5` is a NativeWind class and does
   * not appear in the rendered `style` prop at all, so filtering on
   * `height === 6` matches nothing and the test would pass with zero dots.
   * The inline `backgroundColor` the component sets per dot is the handle,
   * and inside this shell the dots are the only nodes that carry a bare
   * one-key colour style.
   */
  const dotFills = (tree: RenderedNode) =>
    findHostNodes(tree, 'View')
      .map((node) => node.props?.style as Record<string, unknown> | undefined)
      .filter(
        (style): style is { backgroundColor: string } =>
          Boolean(style?.backgroundColor) && Object.keys(style ?? {}).length === 1,
      )
      .map((style) => style.backgroundColor);

  it('draws one progress dot per step', async () => {
    const view = await renderScreen(shell({ totalSteps: 4 }));

    expect(dotFills(view.toJSON() as RenderedNode)).toHaveLength(4);
  });

  it('fills exactly the steps already passed', async () => {
    const view = await renderScreen(shell({ step: 2, totalSteps: 4 }));

    const fills = dotFills(view.toJSON() as RenderedNode);

    // Two distinct colours, split after the second dot. An `index <= step`
    // slip would fill three; `index < step - 1` would fill one.
    expect(fills[0]).toBe(fills[1]);
    expect(fills[2]).toBe(fills[3]);
    expect(fills[1]).not.toBe(fills[2]);
  });

  // The boundary the off-by-one would show at: nothing done yet.
  it('fills nothing on the first step before it is completed', async () => {
    const view = await renderScreen(shell({ step: 0, totalSteps: 3 }));

    expect(new Set(dotFills(view.toJSON() as RenderedNode)).size).toBe(1);
  });

  it('passes the blocked state through to the button', async () => {
    const view = await renderScreen(shell({ actionDisabled: true }));

    expect(view.getByTestId('next')).toBeDisabled();
  });

  it('passes the loading state through too', async () => {
    const view = await renderScreen(shell({ actionLoading: true }));

    expect(view.getByTestId('next')).toBeBusy();
  });
});
