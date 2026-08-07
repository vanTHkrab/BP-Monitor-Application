/**
 * The local "someone asked to be your caregiver" banner.
 *
 * Three refusals carry the weight, and all three are invisible in a happy-path
 * run:
 *
 *   - It must never *request* permission. Asking at the moment an invite
 *     happens to arrive is a prompt the user cannot connect to anything they
 *     did, and on Android 13+ a denial there is permanent.
 *   - It must post one banner for a batch, not one each.
 *   - It must use its own Android channel. A patient who mutes measurement
 *     reminders must not thereby mute a request for access to their medical
 *     history.
 */
const mockLoadNotifications = jest.fn();
jest.mock('./notifications-module', () => ({
  loadNotifications: () => mockLoadNotifications(),
}));

import { Platform } from 'react-native';

import { INVITE_KIND, notifyNewInvites } from './invite-notification';

const notificationsModule = (granted = true) => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted, canAskAgain: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted, canAskAgain: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 4 },
});

type NotificationsStub = ReturnType<typeof notificationsModule>;

const use = (stub: NotificationsStub | null) => {
  mockLoadNotifications.mockResolvedValue(stub);
  return stub;
};

const requestOf = (stub: NotificationsStub) =>
  stub.scheduleNotificationAsync.mock.calls[0][0] as {
    content: { title: string; body: string; data: { kind: string } };
    trigger: { channelId: string } | null;
  };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('when there is nothing to say', () => {
  it('does not even load the notifications module for an empty batch', async () => {
    use(notificationsModule());

    await notifyNewInvites([]);

    // The module import has a side effect on Expo Go Android; not reaching for
    // it at all is cheaper than reaching for it and discarding the result.
    expect(mockLoadNotifications).not.toHaveBeenCalled();
  });

  it('does nothing where notifications are unavailable', async () => {
    use(null);

    await expect(notifyNewInvites(['สมชาย'])).resolves.toBeUndefined();
  });
});

describe('permission', () => {
  it('posts nothing when permission was never granted', async () => {
    const stub = use(notificationsModule(false))!;

    await notifyNewInvites(['สมชาย']);

    expect(stub.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  /*
   * The negative that matters. A prompt fired here arrives with no context the
   * user can attach it to, and on Android 13+ the denial cannot be undone from
   * inside the app.
   */
  it('never asks for permission at the moment an invite arrives', async () => {
    const stub = use(notificationsModule(false))!;

    await notifyNewInvites(['สมชาย']);

    expect(stub.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('the banner', () => {
  it('names the single requester so the patient knows who is asking', async () => {
    const stub = use(notificationsModule())!;

    await notifyNewInvites(['สมชาย']);

    expect(stub.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(requestOf(stub).content.body).toContain('สมชาย');
  });

  /*
   * One banner for the batch, not one each: a patient who opens the app after
   * a while can discover several at once, and three identical banners is how a
   * user learns to swipe this category away.
   */
  it('posts one banner for several invites, counting them instead of naming them', async () => {
    const stub = use(notificationsModule())!;

    await notifyNewInvites(['สมชาย', 'สมหญิง', 'สมศรี']);

    expect(stub.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const body = requestOf(stub).content.body;
    expect(body).toContain('3');
    expect(body).not.toContain('สมหญิง');
  });

  it('stamps its own kind so this module’s notifications stay findable', async () => {
    const stub = use(notificationsModule())!;

    await notifyNewInvites(['สมชาย']);

    expect(requestOf(stub).content.data.kind).toBe(INVITE_KIND);
  });

  /*
   * `trigger: null` means "present it now". The event has already happened by
   * the time this device learns about it, and a delay would put the banner on
   * screen after the user has read the row that caused it.
   */
  it('presents immediately on iOS, with no channel and no delay', async () => {
    const stub = use(notificationsModule())!;

    await notifyNewInvites(['สมชาย']);

    expect(stub.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(requestOf(stub).trigger).toBeNull();
  });
});

describe('on Android', () => {
  let platform: ReturnType<typeof jest.replaceProperty>;

  beforeEach(() => {
    platform = jest.replaceProperty(Platform, 'OS', 'android');
  });

  afterEach(() => {
    platform.restore();
  });

  it('uses a channel of its own, separate from the reminder channels', async () => {
    const stub = use(notificationsModule())!;

    await notifyNewInvites(['สมชาย']);

    expect(stub.setNotificationChannelAsync).toHaveBeenCalledWith(
      'caregiver_invites',
      expect.objectContaining({ importance: 4 }),
    );
    // Muting measurement reminders must not mute a request for access to a
    // medical history; per-channel controls are the only ones the user gets.
    expect(stub.setNotificationChannelAsync.mock.calls[0][0]).not.toContain('bp-reminders');
  });

  it('routes the banner through that channel', async () => {
    const stub = use(notificationsModule())!;

    await notifyNewInvites(['สมชาย']);

    expect(requestOf(stub).trigger).toEqual({ channelId: 'caregiver_invites' });
  });
});
