/**
 * The settings row has three shapes and picks between them silently:
 *
 *   `hasSwitch = typeof value === 'boolean' && Boolean(onValueChange)`
 *
 * A caller that passes `value` but forgets `onValueChange` gets a row with no
 * control at all and no error — the setting simply becomes unreachable. That
 * is the branch worth pinning, and it is not reachable from any screen test
 * because every screen happens to pass both.
 */
import { SettingItem, SettingSection } from '@/components/ui/setting-item';
import { renderScreen } from '../test-utils';
import { hasHostType, type RenderedNode } from './host-tree';

const noop = () => {};

describe('SettingItem', () => {
  it('renders the title, and the subtitle only when given one', async () => {
    const withSubtitle = await renderScreen(
      <SettingItem icon="notifications" title="แจ้งเตือน" subtitle="เปิดการเตือนวัดความดัน" />,
    );
    expect(withSubtitle.getByText('แจ้งเตือน')).toBeOnTheScreen();
    expect(withSubtitle.getByText('เปิดการเตือนวัดความดัน')).toBeOnTheScreen();

    const without = await renderScreen(<SettingItem icon="notifications" title="แจ้งเตือน" />);
    expect(without.queryByText('เปิดการเตือนวัดความดัน')).toBeNull();
  });

  describe('which control it shows', () => {
    it('shows a switch when it has both a value and a handler', async () => {
      const view = await renderScreen(
        <SettingItem icon="notifications" title="แจ้งเตือน" value onValueChange={noop} />,
      );

      // The Switch carries `accessibilityLabel={title}`, which is the only
      // query that reaches it — it has no testID of its own.
      expect(view.getByLabelText('แจ้งเตือน')).toBeOnTheScreen();
    });

    // `value` without `onValueChange` is a row that looks like a setting and
    // cannot be changed. Silent today; this makes it loud.
    it('shows no switch when the value has no handler behind it', async () => {
      const view = await renderScreen(
        <SettingItem icon="notifications" title="แจ้งเตือน" value testID="row" />,
      );

      expect(view.queryByLabelText('แจ้งเตือน')).toBeNull();
      expect(hasHostType(view.toJSON() as RenderedNode, 'Switch')).toBe(false);
    });

    it('is a plain non-tappable card when it has neither a switch nor a press', async () => {
      const view = await renderScreen(
        <SettingItem icon="information-circle" title="เวอร์ชัน" subtitle="1.0.0" testID="row" />,
      );

      expect(view.getByTestId('row')).toBeOnTheScreen();
      // A plain `View` wrapper, not a Pressable: no button role means a
      // screen reader does not invite a tap that does nothing.
      expect(view.queryByRole('button')).toBeNull();
      expect(hasHostType(view.toJSON() as RenderedNode, 'Switch')).toBe(false);
    });

    it('becomes a button when given an onPress', async () => {
      const view = await renderScreen(
        <SettingItem icon="lock-closed" title="ความปลอดภัย" onPress={noop} testID="row" />,
      );

      expect(view.getByRole('button', { name: 'ความปลอดภัย' })).toBeOnTheScreen();
    });
  });

  describe('disabled', () => {
    /*
     * `toBeDisabled()` is vacuous here. The matcher reads
     * `accessibilityState.disabled`, and React Native's `Switch` never sets
     * it — `expect(switch).not.toBeDisabled()` passes whatever `disabled` is.
     * The prop is the only thing that actually stops the toggle, so the prop
     * is what is asserted.
     */
    it('disables the switch itself, not just its appearance', async () => {
      const view = await renderScreen(
        <SettingItem
          icon="notifications"
          title="แจ้งเตือน"
          value
          onValueChange={noop}
          disabled
        />,
      );

      expect(view.getByLabelText('แจ้งเตือน').props.disabled).toBe(true);
    });

    it('leaves the switch enabled otherwise', async () => {
      const view = await renderScreen(
        <SettingItem icon="notifications" title="แจ้งเตือน" value onValueChange={noop} />,
      );

      expect(view.getByLabelText('แจ้งเตือน').props.disabled).toBe(false);
    });

    // A tappable row does carry `accessibilityState`, so here the matcher is
    // the right tool — and the pair proves it discriminates.
    it('disables a tappable row through its accessibility state', async () => {
      const enabled = await renderScreen(
        <SettingItem icon="lock-closed" title="ความปลอดภัย" onPress={noop} testID="row" />,
      );
      expect(enabled.getByTestId('row')).not.toBeDisabled();

      const disabled = await renderScreen(
        <SettingItem icon="lock-closed" title="ความปลอดภัย" onPress={noop} disabled testID="row" />,
      );
      expect(disabled.getByTestId('row')).toBeDisabled();
    });
  });

  // The subtitle is often the row's current state ("เปิดอยู่"), and a screen
  // reader announcing only the title makes those rows indistinguishable.
  it('folds the subtitle into the accessibility label of a tappable row', async () => {
    const view = await renderScreen(
      <SettingItem
        icon="lock-closed"
        title="ล็อกแอป"
        subtitle="เปิดอยู่"
        onPress={noop}
        testID="row"
      />,
    );

    expect(view.getByTestId('row')).toHaveProp('accessibilityLabel', 'ล็อกแอป, เปิดอยู่');
  });
});

describe('SettingSection', () => {
  it('renders its caption', async () => {
    const view = await renderScreen(<SettingSection title="ทั่วไป" />);

    expect(view.getByText('ทั่วไป')).toBeOnTheScreen();
  });
});
