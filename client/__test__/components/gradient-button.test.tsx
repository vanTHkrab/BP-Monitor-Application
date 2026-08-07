/**
 * The primary action button. Its one non-obvious rule is in the source
 * comment: "A press while loading would fire a second mutation against the
 * same form — the spinner is feedback, not a guard." `isBlocked` is
 * `disabled || loading`, and only the `disabled` half is stated by the caller.
 * If that `|| loading` were dropped, nothing else in the suite would notice
 * and every submit button in the app would become double-fireable.
 */
import { GradientButton } from '@/components/ui/gradient-button';
import { renderScreen } from '../test-utils';
import { hasHostType, type RenderedNode } from './host-tree';

const noop = () => {};

describe('GradientButton', () => {
  it('renders its label and is pressable by default', async () => {
    const view = await renderScreen(<GradientButton title="บันทึก" onPress={noop} testID="save" />);

    expect(view.getByText('บันทึก')).toBeOnTheScreen();
    // The enabled case is asserted alongside the disabled ones on purpose:
    // `toBeDisabled()` reads `accessibilityState.disabled`, and a matcher that
    // never returns false is a matcher that proves nothing. This pair is what
    // shows it discriminates on this component.
    expect(view.getByTestId('save')).not.toBeDisabled();
  });

  it('blocks the press when disabled', async () => {
    const view = await renderScreen(
      <GradientButton title="บันทึก" onPress={noop} disabled testID="save" />,
    );

    expect(view.getByTestId('save')).toBeDisabled();
  });

  // The regression this exists for: `loading` must block the press, not just
  // draw a spinner. A caller only ever sets `loading` — never `disabled` — for
  // an in-flight mutation.
  it('blocks the press while loading, even though the caller only said loading', async () => {
    const view = await renderScreen(
      <GradientButton title="บันทึก" onPress={noop} loading testID="save" />,
    );

    expect(view.getByTestId('save')).toBeDisabled();
  });

  it('replaces the label with a spinner while loading', async () => {
    const view = await renderScreen(
      <GradientButton title="บันทึก" onPress={noop} loading testID="save" />,
    );

    expect(hasHostType(view.toJSON() as RenderedNode, 'ActivityIndicator')).toBe(true);
    // Not merely hidden — the label is not rendered at all, so a screen
    // reader on the button announces the busy state rather than "บันทึก".
    expect(view.queryByText('บันทึก')).toBeNull();
  });

  it('announces busy only while loading', async () => {
    const loading = await renderScreen(
      <GradientButton title="บันทึก" onPress={noop} loading testID="save" />,
    );
    expect(loading.getByTestId('save')).toBeBusy();

    const idle = await renderScreen(
      <GradientButton title="บันทึก" onPress={noop} disabled testID="save-2" />,
    );
    // Disabled but not busy: a permanently unavailable button must not
    // announce as one that is working on something.
    expect(idle.getByTestId('save-2')).not.toBeBusy();
    expect(idle.getByTestId('save-2')).toBeDisabled();
  });

  it('renders the icon slot when given one', async () => {
    const view = await renderScreen(
      <GradientButton
        title="ส่งออก"
        onPress={noop}
        icon={<GradientButton title="marker" onPress={noop} testID="icon-slot" />}
      />,
    );

    expect(view.getByTestId('icon-slot')).toBeOnTheScreen();
  });

  it('drops the icon while loading', async () => {
    const view = await renderScreen(
      <GradientButton
        title="ส่งออก"
        onPress={noop}
        loading
        icon={<GradientButton title="marker" onPress={noop} testID="icon-slot" />}
      />,
    );

    expect(view.queryByTestId('icon-slot')).toBeNull();
  });
});
