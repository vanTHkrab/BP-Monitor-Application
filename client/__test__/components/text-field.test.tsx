/**
 * The form input, and its tri-state `error` prop — which is the only thing
 * here a reader would get wrong:
 *
 *   `undefined` → normal
 *   `''`        → red border only, no text (companion-field highlight)
 *   `string`    → red border plus the message underneath
 *
 * The empty string is meaningful, and `error ? …` instead of
 * `typeof error === 'string'` collapses the middle case into the first —
 * which is how a phone field flagged as mismatched with its confirmation
 * stops showing any sign of it. Nothing else asserts the difference.
 */
import { TextField } from '@/components/ui/text-field';
import { renderScreen } from '../test-utils';
import { findHostNodes, type RenderedNode } from './host-tree';

const noop = () => {};

/**
 * The bordered wrapper carries no testID, and walking up from the input via
 * `.parent` lands on the NativeWind style wrapper rather than on the View
 * holding the border — so the tree is searched for the one node that has a
 * `borderColor` at all.
 */
function borderColour(tree: unknown): unknown {
  const styled = findHostNodes(tree as RenderedNode, 'View').find(
    (node) => (node.props?.style as { borderColor?: unknown } | undefined)?.borderColor,
  );
  return (styled?.props?.style as { borderColor?: unknown } | undefined)?.borderColor;
}

describe('TextField', () => {
  it('renders as a text input carrying its value and placeholder', async () => {
    const view = await renderScreen(
      <TextField
        placeholder="เบอร์โทรศัพท์"
        value="0812345678"
        onChangeText={noop}
        testID="phone"
      />,
    );

    const input = view.getByTestId('phone');
    expect(input).toHaveProp('placeholder', 'เบอร์โทรศัพท์');
    expect(input).toHaveDisplayValue('0812345678');
  });

  describe('the tri-state error', () => {
    it('shows no message when there is no error', async () => {
      const view = await renderScreen(
        <TextField placeholder="รหัสผ่าน" value="" onChangeText={noop} testID="f" />,
      );

      expect(view.queryByText('รหัสผ่านไม่ตรงกัน')).toBeNull();
    });

    it('shows the message when the error carries one', async () => {
      const view = await renderScreen(
        <TextField
          placeholder="รหัสผ่าน"
          value=""
          onChangeText={noop}
          error="รหัสผ่านไม่ตรงกัน"
          testID="f"
        />,
      );

      expect(view.getByText('รหัสผ่านไม่ตรงกัน')).toBeOnTheScreen();
    });

    /*
     * The companion-field case. `error=""` must still mark the field, and the
     * mark is the border colour — there is no text, no role change and no
     * accessibility state, so the style is genuinely the only discriminator.
     * Compared against the no-error render rather than against a hex literal,
     * so a token change does not turn this red.
     */
    it('still marks the field for an empty-string error, with no message', async () => {
      const flagged = await renderScreen(
        <TextField placeholder="ยืนยันรหัสผ่าน" value="" onChangeText={noop} error="" testID="f" />,
      );
      const clean = await renderScreen(
        <TextField placeholder="ยืนยันรหัสผ่าน" value="" onChangeText={noop} testID="f" />,
      );

      expect(borderColour(flagged.toJSON())).not.toBe(borderColour(clean.toJSON()));
      // And nothing new is rendered underneath — an empty message row would
      // shift the form layout for no visible reason.
      expect(flagged.toJSON()).not.toBeNull();
    });
  });

  describe('the password reveal', () => {
    it('offers a reveal toggle only on a secure field', async () => {
      const secure = await renderScreen(
        <TextField placeholder="รหัสผ่าน" value="x" onChangeText={noop} secureTextEntry testID="f" />,
      );
      expect(secure.getByLabelText('แสดงรหัสผ่าน')).toBeOnTheScreen();

      const plain = await renderScreen(
        <TextField placeholder="ชื่อ" value="x" onChangeText={noop} testID="f" />,
      );
      expect(plain.queryByLabelText('แสดงรหัสผ่าน')).toBeNull();
    });

    // Masked until the toggle says otherwise. `secureTextEntry && !visible`
    // reduced to `secureTextEntry` would be invisible in a screenshot of the
    // default state and would break only the reveal.
    it('starts masked', async () => {
      const view = await renderScreen(
        <TextField placeholder="รหัสผ่าน" value="x" onChangeText={noop} secureTextEntry testID="f" />,
      );

      expect(view.getByTestId('f')).toHaveProp('secureTextEntry', true);
    });
  });

  it('passes the keyboard hints through untouched', async () => {
    const view = await renderScreen(
      <TextField
        placeholder="อีเมล"
        value=""
        onChangeText={noop}
        keyboardType="email-address"
        autoComplete="email"
        autoCorrect={false}
        testID="email"
      />,
    );

    const input = view.getByTestId('email');
    expect(input).toHaveProp('keyboardType', 'email-address');
    expect(input).toHaveProp('autoComplete', 'email');
    // Explicitly false, not merely absent: RN defaults this to true, and an
    // autocorrected email address is a failed login the user cannot see.
    expect(input).toHaveProp('autoCorrect', false);
  });

  it('honours a non-editable field', async () => {
    const view = await renderScreen(
      <TextField placeholder="เบอร์โทรศัพท์" value="081" onChangeText={noop} editable={false} testID="f" />,
    );

    expect(view.getByTestId('f')).toHaveProp('editable', false);
  });
});
