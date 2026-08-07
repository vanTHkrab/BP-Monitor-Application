/**
 * One linked person, packed into a grouped surface.
 *
 * `muted` is the branch: a sent invite is not yet a person the app knows
 * anything about, so the row swaps the avatar for a clock and dims itself. A
 * pending invite that renders as an established link tells a patient someone
 * already has access to their medical history when they do not — the error
 * runs in the direction of alarming the user about a grant that has not
 * happened.
 */
import { LinkGroup, LinkRow } from '@/modules/caregivers/components/link-row';
import { renderScreen } from '../test-utils';

const noop = () => {};

const props = {
  firstname: 'สมหญิง',
  lastname: 'รักดี',
  name: 'คุณสมหญิง รักดี',
  detail: '0898765432 · ลูก',
  testID: 'link-1',
};

describe('LinkRow', () => {
  it('renders the name and the detail line', async () => {
    const view = await renderScreen(<LinkRow {...props} />);

    expect(view.getByText('คุณสมหญิง รักดี')).toBeOnTheScreen();
    expect(view.getByText('0898765432 · ลูก')).toBeOnTheScreen();
  });

  describe('a pending invite', () => {
    it('dims the row', async () => {
      const active = await renderScreen(<LinkRow {...props} />);
      const pending = await renderScreen(<LinkRow {...props} muted />);

      const opacityOf = (view: Awaited<ReturnType<typeof renderScreen>>) =>
        (view.getByTestId('link-1').props.style as { opacity?: number }).opacity;

      expect(opacityOf(active)).toBe(1);
      expect(opacityOf(pending)).toBeLessThan(1);
    });

    // The avatar is replaced, not merely faded: there is no photo and no
    // profile behind a phone number that has not accepted yet, so initials
    // would be invented from a name the app does not have.
    it('swaps the avatar for a waiting glyph', async () => {
      const active = await renderScreen(<LinkRow {...props} />);
      expect(active.getByLabelText('รูปโปรไฟล์ของ สมหญิง')).toBeOnTheScreen();

      const pending = await renderScreen(<LinkRow {...props} muted />);
      expect(pending.queryByLabelText('รูปโปรไฟล์ของ สมหญิง')).toBeNull();
    });
  });

  describe('the two actions', () => {
    it('offers neither by default, and the row is then inert', async () => {
      const view = await renderScreen(<LinkRow {...props} />);

      expect(view.queryByTestId('link-1-open')).toBeNull();
      expect(view.queryByTestId('link-1-remove')).toBeNull();
      expect(view.queryByRole('button')).toBeNull();
    });

    it('gives each its own control and its own name', async () => {
      const view = await renderScreen(
        <LinkRow {...props} onOpen={noop} onRemove={noop} removeLabel="ยกเลิกคำเชิญถึง" />,
      );

      expect(view.getByTestId('link-1-open')).toHaveProp(
        'accessibilityLabel',
        'ดูข้อมูลของ คุณสมหญิง รักดี',
      );
      expect(view.getByTestId('link-1-remove')).toHaveProp(
        'accessibilityLabel',
        'ยกเลิกคำเชิญถึง คุณสมหญิง รักดี',
      );
    });
  });
});

describe('LinkGroup', () => {
  it('renders its caption and its rows', async () => {
    const view = await renderScreen(
      <LinkGroup title="ผู้ดูแลของฉัน">
        <LinkRow {...props} isLast />
      </LinkGroup>,
    );

    expect(view.getByText('ผู้ดูแลของฉัน')).toBeOnTheScreen();
    expect(view.getByText('คุณสมหญิง รักดี')).toBeOnTheScreen();
  });
});
