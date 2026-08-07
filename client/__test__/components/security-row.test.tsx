/**
 * The row that carries its own answer.
 *
 * "อุปกรณ์ที่เข้าสู่ระบบ · 3 เครื่อง" answers on the hub, so opening it is a
 * choice rather than a search — and the `value` also becomes half the row's
 * accessible name. A screen reader on a hub of four rows that all announce
 * only their title gets no information at all, which is exactly the failure
 * the `value` exists to prevent.
 *
 * The three optional slots — `value`, `hint`, `accessory` — are each a branch,
 * and `accessory` displaces the chevron rather than sitting beside it.
 */
import { Switch } from 'react-native';

import { SecurityGroup, SecurityRow } from '@/modules/security/components/security-row';
import { renderScreen } from '../test-utils';
import { findHostNodes, type RenderedNode } from './host-tree';

const noop = () => {};

describe('SecurityRow', () => {
  it('renders its title', async () => {
    const view = await renderScreen(
      <SecurityRow icon="phone-portrait" title="อุปกรณ์ที่เข้าสู่ระบบ" testID="devices" />,
    );

    expect(view.getByText('อุปกรณ์ที่เข้าสู่ระบบ')).toBeOnTheScreen();
  });

  it('renders the value and the hint only when given them', async () => {
    const full = await renderScreen(
      <SecurityRow
        icon="phone-portrait"
        title="อุปกรณ์ที่เข้าสู่ระบบ"
        value="3 เครื่อง"
        hint="ออกจากระบบเครื่องที่ไม่รู้จักได้"
        testID="devices"
      />,
    );
    expect(full.getByText('3 เครื่อง')).toBeOnTheScreen();
    expect(full.getByText('ออกจากระบบเครื่องที่ไม่รู้จักได้')).toBeOnTheScreen();

    const bare = await renderScreen(
      <SecurityRow icon="phone-portrait" title="อุปกรณ์ที่เข้าสู่ระบบ" testID="devices" />,
    );
    expect(bare.queryByText('3 เครื่อง')).toBeNull();
    expect(bare.queryByText('ออกจากระบบเครื่องที่ไม่รู้จักได้')).toBeNull();
  });

  // The row's whole point, restated for a screen reader.
  it('folds the value into the accessible name', async () => {
    const view = await renderScreen(
      <SecurityRow
        icon="phone-portrait"
        title="อุปกรณ์ที่เข้าสู่ระบบ"
        value="3 เครื่อง"
        onPress={noop}
        testID="devices"
      />,
    );

    expect(view.getByTestId('devices')).toHaveProp(
      'accessibilityLabel',
      'อุปกรณ์ที่เข้าสู่ระบบ, 3 เครื่อง',
    );
  });

  it('announces the title alone when there is no value', async () => {
    const view = await renderScreen(
      <SecurityRow icon="phone-portrait" title="อุปกรณ์ที่เข้าสู่ระบบ" onPress={noop} testID="devices" />,
    );

    expect(view.getByTestId('devices')).toHaveProp('accessibilityLabel', 'อุปกรณ์ที่เข้าสู่ระบบ');
  });

  describe('tappability', () => {
    it('is a button when it navigates', async () => {
      const view = await renderScreen(
        <SecurityRow icon="key" title="รหัสผ่าน" onPress={noop} testID="password" />,
      );

      expect(view.getByTestId('password')).toHaveProp('accessibilityRole', 'button');
      expect(view.getByTestId('password')).not.toBeDisabled();
    });

    it('is inert when it does not — a row that only reports state', async () => {
      const view = await renderScreen(
        <SecurityRow icon="key" title="รหัสผ่าน" value="ตั้งแล้ว" testID="password" />,
      );

      expect(view.getByTestId('password').props.accessibilityRole).toBeUndefined();
    });

    it('reports its disabled state', async () => {
      const view = await renderScreen(
        <SecurityRow icon="key" title="รหัสผ่าน" onPress={noop} disabled testID="password" />,
      );

      expect(view.getByTestId('password')).toBeDisabled();
    });
  });

  describe('the trailing slot', () => {
    // A row with both a switch and a chevron promises two destinations and
    // has one. `accessory ?? chevron` is the rule, and `??` rather than `||`
    // matters here only in that it is unconditional once an accessory exists.
    it('gives the accessory the slot the chevron would have taken', async () => {
      const view = await renderScreen(
        <SecurityRow
          icon="lock-closed"
          title="ล็อกแอป"
          onPress={noop}
          accessory={<Switch value onValueChange={noop} accessibilityLabel="สลับล็อกแอป" />}
          testID="applock"
        />,
      );

      expect(view.getByLabelText('สลับล็อกแอป')).toBeOnTheScreen();
    });
  });

  // The divider groups the rows; drawn under the last one it would slice the
  // surface into strips instead.
  it('omits the divider on the last row', async () => {
    const middle = await renderScreen(
      <SecurityRow icon="key" title="รหัสผ่าน" testID="row" />,
    );
    const last = await renderScreen(
      <SecurityRow icon="key" title="รหัสผ่าน" isLast testID="row" />,
    );

    // Not matched on height: `h-px` is a NativeWind class and never reaches
    // the rendered `style` prop, so a height-based filter finds nothing and
    // the test would pass for both rows. The divider is the only childless
    // View the row draws, and it carries the border colour inline.
    const hairlines = (view: Awaited<ReturnType<typeof renderScreen>>) =>
      findHostNodes(view.toJSON() as RenderedNode, 'View').filter(
        (node) =>
          (node.children ?? []).length === 0 &&
          Boolean((node.props?.style as { backgroundColor?: string } | undefined)?.backgroundColor),
      ).length;

    expect(hairlines(middle)).toBe(1);
    expect(hairlines(last)).toBe(0);
  });
});

describe('SecurityGroup', () => {
  it('renders its caption and its rows', async () => {
    const view = await renderScreen(
      <SecurityGroup title="การเข้าสู่ระบบ">
        <SecurityRow icon="key" title="รหัสผ่าน" isLast />
      </SecurityGroup>,
    );

    expect(view.getByText('การเข้าสู่ระบบ')).toBeOnTheScreen();
    expect(view.getByText('รหัสผ่าน')).toBeOnTheScreen();
  });

  it('renders a captionless group', async () => {
    const view = await renderScreen(
      <SecurityGroup>
        <SecurityRow icon="key" title="รหัสผ่าน" isLast />
      </SecurityGroup>,
    );

    expect(view.getByText('รหัสผ่าน')).toBeOnTheScreen();
    expect(view.queryByText('การเข้าสู่ระบบ')).toBeNull();
  });
});
