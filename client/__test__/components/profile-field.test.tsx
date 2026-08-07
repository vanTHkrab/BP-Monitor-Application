/**
 * The profile screen's row, in whichever of its two modes is active.
 *
 * Read mode is a label and a value, *not* a disabled input — the pattern that
 * makes people tap fields that will not respond. The two modes render
 * genuinely different trees (edit mode drops the value entirely and renders
 * the caller's input instead), so a mode that leaks the other's markup is a
 * structural bug rather than a styling one.
 *
 * The em-dash placeholder is the other thing worth pinning: `value?.trim()`
 * means a field holding only spaces reads as unset, which is what it is. A
 * plain falsy check would render an invisible row that looks like a rendering
 * failure.
 */
import { ThemedText } from '@/components/themed-text';
import {
  ProfileField,
  ProfileGroup,
  ProfileLinkRow,
} from '@/modules/profile/components/profile-field';
import { renderScreen } from '../test-utils';

const noop = () => {};

describe('ProfileField', () => {
  describe('read mode', () => {
    it('shows the label and the value', async () => {
      const view = await renderScreen(
        <ProfileField label="ชื่อ" value="สมชาย" isEditing={false} testID="firstname" />,
      );

      expect(view.getByText('ชื่อ')).toBeOnTheScreen();
      expect(view.getByText('สมชาย')).toBeOnTheScreen();
    });

    it('falls back to an em dash when the field is unset', async () => {
      const view = await renderScreen(
        <ProfileField label="โรคประจำตัว" isEditing={false} testID="disease" />,
      );

      expect(view.getByText('—')).toBeOnTheScreen();
    });

    // Whitespace is unset. Rendering it as a value leaves a blank row that
    // reads as a bug in the app rather than a gap in the profile.
    it('treats a whitespace-only value as unset', async () => {
      const view = await renderScreen(
        <ProfileField label="โรคประจำตัว" value="   " isEditing={false} testID="disease" />,
      );

      expect(view.getByText('—')).toBeOnTheScreen();
    });

    it('ignores any input the caller passed', async () => {
      const view = await renderScreen(
        <ProfileField label="ชื่อ" value="สมชาย" isEditing={false} testID="firstname">
          <ThemedText>ช่องกรอก</ThemedText>
        </ProfileField>,
      );

      expect(view.queryByText('ช่องกรอก')).toBeNull();
    });
  });

  describe('edit mode', () => {
    it('renders the caller’s input under the label', async () => {
      const view = await renderScreen(
        <ProfileField label="ชื่อ" value="สมชาย" isEditing testID="firstname">
          <ThemedText>ช่องกรอก</ThemedText>
        </ProfileField>,
      );

      expect(view.getByText('ชื่อ')).toBeOnTheScreen();
      expect(view.getByText('ช่องกรอก')).toBeOnTheScreen();
    });

    // The value lives in the input the caller controls; rendering it here too
    // would show the old value beside the one being typed.
    it('does not also render the read-mode value', async () => {
      const view = await renderScreen(
        <ProfileField label="ชื่อ" value="สมชาย" isEditing testID="firstname">
          <ThemedText>ช่องกรอก</ThemedText>
        </ProfileField>,
      );

      expect(view.queryByText('สมชาย')).toBeNull();
    });
  });
});

describe('ProfileLinkRow', () => {
  it('renders the label and announces itself as a button', async () => {
    const view = await renderScreen(
      <ProfileLinkRow label="ความปลอดภัย" onPress={noop} testID="security" />,
    );

    expect(view.getByText('ความปลอดภัย')).toBeOnTheScreen();
    expect(view.getByTestId('security')).toHaveProp('accessibilityRole', 'button');
  });

  it('folds the value into the accessible name when there is one', async () => {
    const view = await renderScreen(
      <ProfileLinkRow label="ความปลอดภัย" value="ตั้งค่าแล้ว" onPress={noop} testID="security" />,
    );

    expect(view.getByTestId('security')).toHaveProp(
      'accessibilityLabel',
      'ความปลอดภัย, ตั้งค่าแล้ว',
    );
  });

  it('announces the label alone when there is not', async () => {
    const view = await renderScreen(
      <ProfileLinkRow label="ความปลอดภัย" onPress={noop} testID="security" />,
    );

    expect(view.getByTestId('security')).toHaveProp('accessibilityLabel', 'ความปลอดภัย');
  });
});

describe('ProfileGroup', () => {
  it('renders its caption and its fields', async () => {
    const view = await renderScreen(
      <ProfileGroup title="ข้อมูลส่วนตัว">
        <ProfileField label="ชื่อ" value="สมชาย" isEditing={false} isLast />
      </ProfileGroup>,
    );

    expect(view.getByText('ข้อมูลส่วนตัว')).toBeOnTheScreen();
    expect(view.getByText('สมชาย')).toBeOnTheScreen();
  });
});
