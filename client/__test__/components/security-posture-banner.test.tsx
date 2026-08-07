/**
 * The security screen's answer, before its settings.
 *
 * Two things worth pinning. The **action row is conditional on both**
 * `actionRoute` and `actionLabel` — a posture that has one but not the other
 * must render no button, because a button with no label is a tappable blank
 * and a labelled button with nowhere to go is a dead end on the one screen
 * where a user is already anxious.
 *
 * And the **tone drives an accent that must actually differ**. `good`,
 * `attention`, and `risk` are the whole severity vocabulary here; a tone
 * table edited to point two of them at the same colour leaves "you have been
 * breached" looking exactly like "you could add a passkey".
 */
import { SecurityPostureBanner } from '@/modules/security/components/security-posture-banner';
import type { SecurityPosture } from '@/modules/security/lib/security-posture';
import { renderScreen } from '../test-utils';

const noop = () => {};

const posture = (overrides: Partial<SecurityPosture> = {}): SecurityPosture =>
  ({
    tone: 'good',
    headline: 'บัญชีของคุณปลอดภัยดี',
    detail: 'คุณตั้งรหัสผ่านและเพิ่ม Passkey แล้ว',
    ...overrides,
  }) as SecurityPosture;

describe('SecurityPostureBanner', () => {
  it('renders the headline and the detail', async () => {
    const view = await renderScreen(
      <SecurityPostureBanner posture={posture()} onAction={noop} />,
    );

    expect(view.getByText('บัญชีของคุณปลอดภัยดี')).toBeOnTheScreen();
    expect(view.getByText('คุณตั้งรหัสผ่านและเพิ่ม Passkey แล้ว')).toBeOnTheScreen();
  });

  describe('the action row', () => {
    it('renders when the posture has both a route and a label', async () => {
      const view = await renderScreen(
        <SecurityPostureBanner
          posture={posture({
            tone: 'attention',
            actionRoute: '/security/passkeys',
            actionLabel: 'เพิ่ม Passkey',
          })}
          onAction={noop}
        />,
      );

      // Queried as text rather than via `toHaveTextContent` on the Pressable:
      // that matcher is exact-match in RNTL and the row also contains an
      // arrow glyph, so the aggregated content is the label *plus* a private-
      // use character and the comparison fails against two visually identical
      // strings.
      expect(view.getByTestId('security-posture-action')).toBeOnTheScreen();
      expect(view.getByText('เพิ่ม Passkey')).toBeOnTheScreen();
    });

    it('is withheld when the posture has nothing to act on', async () => {
      const view = await renderScreen(
        <SecurityPostureBanner posture={posture()} onAction={noop} />,
      );

      expect(view.queryByTestId('security-posture-action')).toBeNull();
    });

    // A route with no label is a blank tappable strip.
    it('is withheld when there is a route but no label', async () => {
      const view = await renderScreen(
        <SecurityPostureBanner
          posture={posture({ actionRoute: '/security/passkeys' })}
          onAction={noop}
        />,
      );

      expect(view.queryByTestId('security-posture-action')).toBeNull();
    });

    // A label with no route is a button that goes nowhere.
    it('is withheld when there is a label but no route', async () => {
      const view = await renderScreen(
        <SecurityPostureBanner posture={posture({ actionLabel: 'เพิ่ม Passkey' })} onAction={noop} />,
      );

      expect(view.queryByTestId('security-posture-action')).toBeNull();
    });
  });

  /*
   * The accent is the only thing separating the three severities — the layout
   * is identical. Compared as a set rather than against hex literals: what
   * must hold is that no two tones collide, not what any one of them is.
   */
  it('gives each tone its own accent', async () => {
    const accents = new Set<string>();

    for (const tone of ['good', 'attention', 'risk'] as const) {
      const view = await renderScreen(
        <SecurityPostureBanner
          posture={posture({ tone, actionRoute: '/security/password', actionLabel: 'ไป' })}
          onAction={noop}
        />,
      );

      // The action label wears the accent, and it is the one node that both
      // carries the colour and is reachable by a query.
      const style = view.getByText('ไป').props.style as { color?: string }[] | { color?: string };
      const flat = (Array.isArray(style) ? style : [style]).filter(Boolean);
      const colour = flat.map((entry) => entry?.color).filter(Boolean).at(-1);

      expect(colour).toBeDefined();
      accents.add(colour as string);
    }

    expect(accents.size).toBe(3);
  });
});
