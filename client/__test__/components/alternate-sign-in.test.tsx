/**
 * The ways in that are not phone + password.
 *
 * The ordering is the whole component. From its own docblock: "the order and
 * the 'ใช้ครั้งล่าสุด' badge depend on what this device did last, and that
 * logic has to sit next to the buttons it reorders or it will drift the first
 * time someone adds a third method." Someone who signed in with a passkey last
 * month does not remember that they did; being told is the difference between
 * one tap and a password reset.
 *
 * **Ordering is asserted as ordering**, not as "both are present". Two
 * `getByTestId` calls both pass with the list the wrong way round, which is
 * the exact shape of assertion this project warns against.
 */
import { AlternateSignIn } from '@/modules/auth/components/alternate-sign-in';
import { renderScreen } from '../test-utils';
import { findHostNodes, type RenderedNode } from './host-tree';

const noop = () => {};

/** The two buttons in the order they are laid out, by testID. */
function methodOrder(tree: RenderedNode): string[] {
  return findHostNodes(tree, 'View')
    .map((node) => node.props?.testID)
    .filter((id): id is string => id === 'login-passkey' || id === 'login-google');
}

describe('AlternateSignIn', () => {
  // No alternatives configured is not "an empty section with a หรือ divider";
  // it is nothing at all, or the login card grows a rule across it for no
  // reason.
  it('renders nothing when neither method is available', async () => {
    const view = await renderScreen(<AlternateSignIn lastUsed={null} />);

    // `toJSON()` is the provider wrapper, never null — the assertion is that
    // the component contributed nothing to it.
    expect((view.toJSON() as { children?: unknown[] | null }).children ?? []).toHaveLength(0);
  });

  it('renders only the method it was given a handler for', async () => {
    const view = await renderScreen(<AlternateSignIn lastUsed={null} onGoogle={noop} />);

    expect(view.getByTestId('login-google')).toBeOnTheScreen();
    expect(view.queryByTestId('login-passkey')).toBeNull();
  });

  // The mirror image of the above. Both flags in `login.tsx`
  // (`PASSKEY_ENABLED`, `GOOGLE_SIGN_IN_ENABLED`) reach this component the
  // same way — as a missing handler — so the component has to be equally
  // unbiased about which one is missing.
  it('renders passkey alone just as readily as Google alone', async () => {
    const view = await renderScreen(<AlternateSignIn lastUsed={null} onPasskey={noop} />);

    expect(view.getByTestId('login-passkey')).toBeOnTheScreen();
    expect(view.queryByTestId('login-google')).toBeNull();
  });

  describe('ordering', () => {
    it('puts passkey first when it is declared first and nothing was used last', async () => {
      const view = await renderScreen(
        <AlternateSignIn lastUsed={null} onPasskey={noop} onGoogle={noop} />,
      );

      expect(methodOrder(view.toJSON() as RenderedNode)).toEqual(['login-passkey', 'login-google']);
    });

    // The reordering. Both buttons render either way, so only the sequence
    // distinguishes a working hint from a broken one.
    it('promotes the method this device used last', async () => {
      const view = await renderScreen(
        <AlternateSignIn lastUsed="google" onPasskey={noop} onGoogle={noop} />,
      );

      expect(methodOrder(view.toJSON() as RenderedNode)).toEqual(['login-google', 'login-passkey']);
    });
  });

  describe('the badge', () => {
    it('marks the method used last', async () => {
      const view = await renderScreen(
        <AlternateSignIn lastUsed="passkey" onPasskey={noop} onGoogle={noop} />,
      );

      expect(view.getByText('ใช้ครั้งล่าสุด')).toBeOnTheScreen();
      expect(view.getByTestId('login-passkey')).toHaveProp(
        'accessibilityLabel',
        'เข้าสู่ระบบด้วย Passkey (ใช้ครั้งล่าสุด)',
      );
    });

    // A hint that appears on nothing is better than one on everything: the
    // badge only means something if it is on exactly one row.
    it('marks nothing when this device has no history', async () => {
      const view = await renderScreen(
        <AlternateSignIn lastUsed={null} onPasskey={noop} onGoogle={noop} />,
      );

      expect(view.queryByText('ใช้ครั้งล่าสุด')).toBeNull();
      expect(view.getByTestId('login-google')).toHaveProp(
        'accessibilityLabel',
        'เข้าสู่ระบบด้วย Google',
      );
    });

    /*
     * `lastUsed` is device-local and survives a method being withdrawn — a
     * phone that signed in with a passkey before the feature was hidden still
     * has `'passkey'` stored. The badge is keyed by identity rather than by
     * position, so the surviving row does not inherit it; asserting that is
     * what keeps the component's own promise that a wrong hint never becomes a
     * dead end, since a badge on Google here would be an outright false one.
     */
    it('marks nothing when the method used last is no longer offered', async () => {
      const view = await renderScreen(<AlternateSignIn lastUsed="passkey" onGoogle={noop} />);

      expect(view.queryByText('ใช้ครั้งล่าสุด')).toBeNull();
      expect(view.getByTestId('login-google')).toHaveProp(
        'accessibilityLabel',
        'เข้าสู่ระบบด้วย Google',
      );
    });

    // The reverse withdrawal: `GOOGLE_SIGN_IN_ENABLED` hides Google the same
    // way `PASSKEY_ENABLED` hides passkey — a missing `onGoogle` handler — so
    // a device that used Google last before this shipped must not badge
    // whichever method survives.
    it('marks nothing when Google specifically is the method no longer offered', async () => {
      const view = await renderScreen(<AlternateSignIn lastUsed="google" onPasskey={noop} />);

      expect(view.queryByText('ใช้ครั้งล่าสุด')).toBeNull();
      expect(view.getByTestId('login-passkey')).toHaveProp(
        'accessibilityLabel',
        'เข้าสู่ระบบด้วย Passkey',
      );
    });

    it('marks only one row when both methods are present', async () => {
      const view = await renderScreen(
        <AlternateSignIn lastUsed="google" onPasskey={noop} onGoogle={noop} />,
      );

      expect(view.getAllByText('ใช้ครั้งล่าสุด')).toHaveLength(1);
    });
  });

  describe('pending', () => {
    // A second tap while a passkey prompt is already up fires a second
    // WebAuthn ceremony, and the OS sheet from the first one hides the result.
    it('disables the method that is in flight', async () => {
      const view = await renderScreen(
        <AlternateSignIn lastUsed={null} onPasskey={noop} onGoogle={noop} isPasskeyPending />,
      );

      expect(view.getByTestId('login-passkey')).toBeDisabled();
    });

    it('leaves the other one alone', async () => {
      const view = await renderScreen(
        <AlternateSignIn lastUsed={null} onPasskey={noop} onGoogle={noop} isPasskeyPending />,
      );

      expect(view.getByTestId('login-google')).not.toBeDisabled();
    });
  });
});
