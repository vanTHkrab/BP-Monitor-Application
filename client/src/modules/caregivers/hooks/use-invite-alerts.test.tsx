/**
 * When a caregiver request becomes a notification, and — more importantly —
 * when it does not.
 *
 * Both failure modes here are invisible in a happy-path run and obvious to a
 * user: re-announcing a request the patient has already seen teaches them to
 * mute the category, and staying silent for a genuinely new one defeats the
 * feature. The persisted "already announced" set is what separates them, so
 * that is what these pin.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

// `mock` prefix required: jest hoists the factory above this declaration.
// The wrapper is required for the same reason — the factory runs while the
// imports below are being resolved, which is before this `const` has been
// initialised, so reading the spy directly there captures `undefined`.
const mockNotifyNewInvites = jest.fn();
jest.mock('@/modules/notifications', () => ({
  notifyNewInvites: (...args: unknown[]) => mockNotifyNewInvites(...args),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook, waitFor } from '@testing-library/react-native';

import { announcedInvitesKey } from '@/config';

import { useInviteAlerts } from './use-invite-alerts';
import type { CaregiverLink } from '../types';

const USER = 'u1';

const invite = (caregiverId: string, name = 'สมหญิง ใจงาม'): CaregiverLink => ({
  caregiverId,
  patientId: USER,
  relationship: 'child',
  caregiverName: name,
  caregiverPhone: '0898765432',
  permission: 'full',
  patientName: 'สมชาย ใจดี',
  patientPhone: '0812345678',
  status: 'pending',
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

/** The hook reads storage before it can decide anything; let that settle. */
const renderWith = async (invites: CaregiverLink[]) => {
  const view = await renderHook(
    ({ list }: { list: CaregiverLink[] }) => useInviteAlerts(list, USER),
    { initialProps: { list: invites } },
  );
  await waitFor(() =>
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(announcedInvitesKey(USER)),
  );
  return view;
};

it('stays silent on the first list this device sees', async () => {
  const view = await renderWith([invite('c1')]);
  await view.rerender({ list: [invite('c1')] });

  expect(mockNotifyNewInvites).not.toHaveBeenCalled();
});

it('announces a request that arrives after the baseline', async () => {
  const view = await renderWith([]);
  await view.rerender({ list: [invite('c1', 'สมหญิง ใจงาม')] });

  await waitFor(() =>
    expect(mockNotifyNewInvites).toHaveBeenCalledWith(['สมหญิง ใจงาม']),
  );
});

// The bug this guards: a patient whose first list is empty — the common case
// on a fresh account — would otherwise have their very first request treated
// as the baseline and never hear about it.
it('treats an empty first list as a baseline, not as nothing to seed', async () => {
  const view = await renderWith([]);
  await view.rerender({ list: [invite('c1')] });

  await waitFor(() => expect(mockNotifyNewInvites).toHaveBeenCalledTimes(1));
});

it('does not re-announce the same request on a refetch', async () => {
  const view = await renderWith([]);
  await view.rerender({ list: [invite('c1')] });
  await waitFor(() => expect(mockNotifyNewInvites).toHaveBeenCalledTimes(1));

  await view.rerender({ list: [invite('c1')] });
  await view.rerender({ list: [invite('c1')] });

  expect(mockNotifyNewInvites).toHaveBeenCalledTimes(1);
});

it('announces a batch as one notification, not one each', async () => {
  const view = await renderWith([]);
  await view.rerender({ list: [invite('c1', 'ก'), invite('c2', 'ข')] });

  await waitFor(() => expect(mockNotifyNewInvites).toHaveBeenCalledTimes(1));
  expect(mockNotifyNewInvites).toHaveBeenCalledWith(['ก', 'ข']);
});

// A relaunch re-reads the set from storage; anything already announced must
// stay announced across it.
it('remembers across a remount', async () => {
  const first = await renderWith([]);
  await first.rerender({ list: [invite('c1')] });
  await waitFor(() => expect(mockNotifyNewInvites).toHaveBeenCalledTimes(1));
  first.unmount();

  const second = await renderWith([invite('c1')]);
  await second.rerender({ list: [invite('c1')] });

  expect(mockNotifyNewInvites).toHaveBeenCalledTimes(1);
});
