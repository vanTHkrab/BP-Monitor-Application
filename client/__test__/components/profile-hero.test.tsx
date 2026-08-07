/**
 * Avatar, name, and role at the top of the profile screen.
 *
 * `fullName || 'ยังไม่ได้ตั้งชื่อ'` is the branch that matters: a Google
 * sign-up can land with neither name set, and a hero with a blank space where
 * the name goes reads as a rendering failure on the first screen the user
 * opens after signing up.
 *
 * The upload overlay and the camera badge are mutually exclusive, and the
 * photo target is disabled while an upload is in flight — a second tap would
 * open the picker over an upload the user cannot see the result of.
 */
import { ProfileHero } from '@/modules/profile/components/profile-hero';
import { renderScreen } from '../test-utils';
import { hasHostType, type RenderedNode } from './host-tree';

const noop = () => {};

describe('ProfileHero', () => {
  it('renders the full name', async () => {
    const view = await renderScreen(
      <ProfileHero firstname="สมชาย" lastname="ใจดี" onChangeAvatar={noop} />,
    );

    expect(view.getByText('สมชาย ใจดี')).toBeOnTheScreen();
  });

  it('trims to whichever half exists', async () => {
    const view = await renderScreen(
      <ProfileHero firstname="สมชาย" lastname="" onChangeAvatar={noop} />,
    );

    expect(view.getByText('สมชาย')).toBeOnTheScreen();
  });

  // The Google-sign-up case.
  it('says so when there is no name at all', async () => {
    const view = await renderScreen(<ProfileHero firstname="" lastname="" onChangeAvatar={noop} />);

    expect(view.getByText('ยังไม่ได้ตั้งชื่อ')).toBeOnTheScreen();
  });

  describe('the role chip', () => {
    it.each([
      ['patient', 'ผู้ป่วย'],
      ['caregiver', 'ผู้ดูแล'],
      ['developer', 'นักพัฒนา'],
    ] as const)('names a %s in Thai', async (role, label) => {
      const view = await renderScreen(
        <ProfileHero firstname="ก" lastname="ข" role={role} onChangeAvatar={noop} />,
      );

      expect(view.getByText(label)).toBeOnTheScreen();
    });

    // `role` is optional and absent until `me` resolves. An empty chip on
    // first paint is a grey pill that means nothing.
    it('renders no chip before the role is known', async () => {
      const view = await renderScreen(<ProfileHero firstname="ก" lastname="ข" onChangeAvatar={noop} />);

      expect(view.queryByText('ผู้ป่วย')).toBeNull();
      expect(view.queryByText('ผู้ดูแล')).toBeNull();
    });
  });

  describe('while an avatar upload is in flight', () => {
    it('covers the photo with a spinner instead of the camera badge', async () => {
      const view = await renderScreen(
        <ProfileHero firstname="ก" lastname="ข" isUploading onChangeAvatar={noop} />,
      );

      expect(hasHostType(view.toJSON() as RenderedNode, 'ActivityIndicator')).toBe(true);
      expect(view.getByTestId('profile-avatar')).toBeBusy();
    });

    it('blocks a second tap on the photo', async () => {
      const view = await renderScreen(
        <ProfileHero firstname="ก" lastname="ข" isUploading onChangeAvatar={noop} />,
      );

      expect(view.getByTestId('profile-avatar')).toBeDisabled();
    });

    it('leaves the photo tappable otherwise', async () => {
      const view = await renderScreen(<ProfileHero firstname="ก" lastname="ข" onChangeAvatar={noop} />);

      expect(view.getByTestId('profile-avatar')).not.toBeDisabled();
      expect(view.getByTestId('profile-avatar')).not.toBeBusy();
      expect(hasHostType(view.toJSON() as RenderedNode, 'ActivityIndicator')).toBe(false);
    });
  });

  /*
   * The photo is tappable at all times, not only in edit mode — hiding it
   * behind "แก้ไข" made the most-wanted change on the screen the one with the
   * most steps. So the button and its label exist in the default render.
   */
  it('offers the photo as a labelled control by default', async () => {
    const view = await renderScreen(<ProfileHero firstname="ก" lastname="ข" onChangeAvatar={noop} />);

    expect(view.getByRole('button', { name: 'เปลี่ยนรูปโปรไฟล์' })).toBeOnTheScreen();
  });
});
