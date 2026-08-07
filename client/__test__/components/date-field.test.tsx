/**
 * Date of birth as a button that opens the OS picker.
 *
 * The branch worth pinning is the **web degradation**.
 * `@react-native-community/datetimepicker` has no react-native-web build, so
 * on web the row becomes a read-only value with a note. Getting that inverted
 * ships a control that appears tappable and does nothing — the exact pattern
 * the component's own docblock says it exists to avoid, and one nobody sees
 * because the app is developed on native.
 *
 * The clear button is also gated on `value && !isWeb`: offering "ล้างวันเกิด"
 * on a platform where the date cannot be set again is a one-way door.
 */
import { Platform } from 'react-native';

import { DateField } from '@/modules/profile/components/date-field';
import { renderScreen } from '../test-utils';

const noop = () => {};

const props = {
  value: null as Date | null,
  onChange: noop,
  displayValue: '',
  placeholder: 'เลือกวันเกิด',
  testID: 'dob',
};

/**
 * `Platform.OS` is a getter on a frozen-ish module object, so it is patched
 * for the duration of a test rather than mocked at the module level — a
 * `jest.mock('react-native')` here would take the whole renderer with it.
 */
function onPlatform(os: 'ios' | 'android' | 'web', run: () => Promise<void>) {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  return run().finally(() => {
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
  });
}

describe('DateField', () => {
  it('shows the placeholder while nothing is chosen', async () => {
    const view = await renderScreen(<DateField {...props} />);

    expect(view.getByText('เลือกวันเกิด')).toBeOnTheScreen();
    expect(view.getByTestId('dob')).toHaveProp('accessibilityLabel', 'เลือกวันเกิด');
  });

  it('shows the formatted date once there is one', async () => {
    const view = await renderScreen(
      <DateField {...props} value={new Date('1955-03-01')} displayValue="1 มีนาคม 2498" />,
    );

    expect(view.getByText('1 มีนาคม 2498')).toBeOnTheScreen();
    // The label follows the value, so a screen reader reads the birthday
    // rather than the prompt to pick one.
    expect(view.getByTestId('dob')).toHaveProp('accessibilityLabel', '1 มีนาคม 2498');
  });

  it('renders an error message under the field', async () => {
    const view = await renderScreen(<DateField {...props} error="กรุณาเลือกวันเกิด" />);

    expect(view.getByText('กรุณาเลือกวันเกิด')).toBeOnTheScreen();
  });

  it('renders none when there is no error', async () => {
    const view = await renderScreen(<DateField {...props} />);

    expect(view.queryByText('กรุณาเลือกวันเกิด')).toBeNull();
  });

  describe('the clear button', () => {
    it('appears once there is a date to clear', async () => {
      const view = await renderScreen(
        <DateField {...props} value={new Date('1955-03-01')} displayValue="1 มีนาคม 2498" />,
      );

      expect(view.getByLabelText('ล้างวันเกิด')).toBeOnTheScreen();
    });

    it('is absent while the field is empty', async () => {
      const view = await renderScreen(<DateField {...props} />);

      expect(view.queryByLabelText('ล้างวันเกิด')).toBeNull();
    });
  });

  describe('on web', () => {
    it('says where the birthday can be edited instead of pretending to work', () =>
      onPlatform('web', async () => {
        const view = await renderScreen(<DateField {...props} displayValue="1 มีนาคม 2498" />);

        expect(view.getByText('แก้ไขวันเกิดได้จากแอปบนมือถือ')).toBeOnTheScreen();
      }));

    it('disables the control rather than opening a picker that does not exist', () =>
      onPlatform('web', async () => {
        const view = await renderScreen(<DateField {...props} />);

        expect(view.getByTestId('dob')).toBeDisabled();
      }));

    // A one-way door: cleared on web, and no way to set it again from web.
    it('withholds the clear button even when there is a date', () =>
      onPlatform('web', async () => {
        const view = await renderScreen(
          <DateField {...props} value={new Date('1955-03-01')} displayValue="1 มีนาคม 2498" />,
        );

        expect(view.queryByLabelText('ล้างวันเกิด')).toBeNull();
      }));

    it('shows no such note on native', () =>
      onPlatform('ios', async () => {
        const view = await renderScreen(<DateField {...props} />);

        expect(view.queryByText('แก้ไขวันเกิดได้จากแอปบนมือถือ')).toBeNull();
        expect(view.getByTestId('dob')).not.toBeDisabled();
      }));
  });
});
