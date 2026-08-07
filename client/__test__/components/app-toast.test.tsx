/**
 * The app's single toast surface, and the two guards nothing else exercises.
 *
 * `isHandledNatively` marks a toast the platform already drew. Rendering ours
 * on top shows it twice, and the duplicate is only visible on a real device —
 * exactly the class of bug a render test is for.
 *
 * The tone falls back to `success` for anything that is not a known tone.
 * Callers set it through `customData`, which is untyped at the call site, so a
 * typo lands here as `undefined` — and an error reported in the success green
 * with a checkmark is worse than no toast at all. `isTone` is the guard, and
 * only the fallback half of it is reachable from a caller's mistake.
 */
type ToastState = {
  id: string;
  title: string;
  message?: string;
  duration?: number;
  isHandledNatively?: boolean;
  customData?: Record<string, unknown> | null;
} | null;

/*
 * `useToastState` is Tamagui's own imperative channel — there is no prop to
 * pass and no controller reachable without pushing a toast, which would be an
 * interaction. `requireActual` keeps `ToastProvider` and `Toast` real, since
 * `test-utils` mounts the provider and the component renders `Toast.Title`.
 */
const mockToast: { current: ToastState } = { current: null };

jest.mock('tamagui', () => ({
  ...jest.requireActual('tamagui'),
  useToastState: () => mockToast.current,
}));

import { ToastViewport } from 'tamagui';

import { AppToast } from '@/components/ui/app-toast';
import { renderScreen } from '../test-utils';

/**
 * `AppToast` cannot be rendered on its own: Tamagui's `Toast` portals into a
 * `ToastViewport`, and with no viewport mounted it renders nothing at all —
 * which reads as "the component is broken" rather than "the harness is
 * missing a piece". `app/_layout.tsx` mounts the pair together, so the test
 * does too.
 */
const renderToast = () =>
  renderScreen(
    <>
      <ToastViewport />
      <AppToast />
    </>,
  );

beforeEach(() => {
  mockToast.current = null;
});

describe('AppToast', () => {
  it('renders nothing when there is no toast', async () => {
    const view = await renderToast();

    expect(view.queryByText(/./)).toBeNull();
  });

  it('renders the title of a pushed toast', async () => {
    mockToast.current = { id: '1', title: 'บันทึกแล้ว' };
    const view = await renderToast();

    expect(view.getByText('บันทึกแล้ว')).toBeOnTheScreen();
  });

  it('renders the optional message only when there is one', async () => {
    mockToast.current = { id: '1', title: 'ส่งออกไม่สำเร็จ', message: 'ลองใหม่อีกครั้ง' };
    const withMessage = await renderToast();
    expect(withMessage.getByText('ลองใหม่อีกครั้ง')).toBeOnTheScreen();

    mockToast.current = { id: '2', title: 'ส่งออกไม่สำเร็จ' };
    const without = await renderToast();
    expect(without.queryByText('ลองใหม่อีกครั้ง')).toBeNull();
  });

  // The duplicate-toast guard. Nothing on screen distinguishes a natively
  // handled toast, so the assertion is that the component draws nothing.
  it('draws nothing for a toast the platform already showed', async () => {
    mockToast.current = { id: '1', title: 'บันทึกแล้ว', isHandledNatively: true };
    const view = await renderToast();

    expect(view.queryByText('บันทึกแล้ว')).toBeNull();
  });

  describe('tone', () => {
    /*
     * The icon and its colour are the whole of the tone, and neither is
     * queryable — the glyph is a `Text` child of the icon font. The two tones
     * are compared against each other rather than against hex literals: what
     * must hold is that an error never renders as a success.
     */
    const palette = async (customData: Record<string, unknown> | null) => {
      mockToast.current = { id: '1', title: 'x', customData };
      const view = await renderToast();

      // Every colour the toast draws, not just the icon's: the icon glyph is
      // an `@expo/vector-icons` `Text` whose style is composed, so picking
      // "the first coloured node" lands on `Toast.Title` and reports the same
      // value for both tones — a comparison that can never fail.
      return view
        .getAllByText(/./)
        .flatMap((node) => (Array.isArray(node.props.style) ? node.props.style : [node.props.style]))
        .map((style: { color?: string } | undefined) => style?.color)
        .filter(Boolean)
        .sort()
        .join(',');
    };

    it('renders an error differently from a success', async () => {
      expect(await palette({ tone: 'error' })).not.toBe(await palette({ tone: 'success' }));
    });

    it('falls back to success for an unrecognised tone', async () => {
      // A caller typo — `customData` is untyped at the call site.
      expect(await palette({ tone: 'warning' })).toBe(await palette({ tone: 'success' }));
    });

    it('falls back to success when there is no customData at all', async () => {
      expect(await palette(null)).toBe(await palette({ tone: 'success' }));
    });
  });
});
