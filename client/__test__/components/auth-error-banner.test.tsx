/**
 * The form-level error banner. Two tones, and the difference is entirely
 * colour and icon — the copy comes from the caller.
 *
 * `info` is for expected notices, the live one being "your session expired,
 * sign in again" on arrival at the login screen. Rendering that in the error
 * red tells a user who did nothing wrong that something failed, on the screen
 * where they are least able to judge. Nothing about the markup separates the
 * two, so the accent is the assertion — compared between tones rather than
 * against a hex literal.
 */
import { AuthErrorBanner } from '@/modules/auth/components/auth-error-banner';
import { renderScreen } from '../test-utils';

describe('AuthErrorBanner', () => {
  it('renders the message it is handed', async () => {
    const view = await renderScreen(<AuthErrorBanner message="เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง" />);

    expect(view.getByText('เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง')).toBeOnTheScreen();
  });

  it('renders an info notice differently from an error', async () => {
    const accentOf = async (tone: 'error' | 'info') => {
      const view = await renderScreen(<AuthErrorBanner message="ข้อความ" tone={tone} />);
      const style = view.getByText('ข้อความ').props.style as { color?: string }[] | { color?: string };
      const flat = (Array.isArray(style) ? style : [style]).filter(Boolean);
      return flat.map((entry) => entry?.color).filter(Boolean).at(-1);
    };

    const error = await accentOf('error');
    const info = await accentOf('info');

    expect(error).toBeDefined();
    expect(info).not.toBe(error);
  });

  // `error` is the default for a reason — an unlabelled banner is far more
  // often a failure than a notice, and a default of `info` would understate
  // every caller that forgot the prop.
  it('defaults to the error tone', async () => {
    const bare = await renderScreen(<AuthErrorBanner message="ข้อความ" />);
    const explicit = await renderScreen(<AuthErrorBanner message="ข้อความ" tone="error" />);

    expect(JSON.stringify(bare.toJSON())).toBe(JSON.stringify(explicit.toJSON()));
  });
});
