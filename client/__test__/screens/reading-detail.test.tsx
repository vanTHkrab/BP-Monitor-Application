/**
 * Reading detail — the photo, which is the part that was broken.
 *
 * A reading fetched from the server carries only `s3Key`, and this screen used
 * to render a placeholder for it unconditionally: every reading taken on
 * another device, and every reading after a reinstall, showed "the photo is on
 * the server" forever. What is asserted here is the wiring that fixed it —
 * which source the screen prefers, and that a failed resolve lands on a
 * placeholder rather than a broken image.
 *
 * `lib/image-cache.test.ts` covers the cache's own decisions. This file mocks
 * `resolveImageUri` because the real one downloads a file.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'remote-1' }),
}));

jest.mock('@/modules/auth', () => ({
  useSession: () => ({ userId: 'u1', isAuthenticated: true }),
}));

jest.mock('@/modules/caregivers', () => ({
  useActivePatient: () => ({ viewingPatientId: undefined }),
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

/** Records what the screen handed the cache, and controls what comes back. */
const mockResolve = jest.fn<Promise<string | undefined>, [string | null | undefined]>();
jest.mock('@/modules/readings/lib/image-cache', () => ({
  resolveImageUri: (uri: string | null | undefined) => mockResolve(uri),
}));

const mockReadings = { current: [] as Record<string, unknown>[] };
jest.mock('@/modules/readings', () => ({
  ...jest.requireActual('@/modules/readings'),
  useReadings: () => ({ readings: mockReadings.current, isLoading: false }),
  useDeleteReading: () => ({ deleteReading: jest.fn(), isDeleting: false, error: null }),
}));

import ReadingDetailScreen from '@/app/reading/[id]';
import { renderScreen, waitFor } from '../test-utils';

const reading = (over: Record<string, unknown> = {}) => ({
  key: 'remote-1',
  remoteId: 1,
  userId: 'u1',
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: new Date('2026-07-29T08:00:00.000Z'),
  status: 'elevated',
  createdAt: new Date('2026-07-29T08:00:01.000Z'),
  syncState: 'synced',
  ...over,
});

const SIGNED_URL =
  'https://bucket.s3.amazonaws.com/users/u1/readings/abc.jpg?X-Amz-Signature=aaa';

beforeEach(() => {
  jest.clearAllMocks();
  mockReadings.current = [reading()];
  mockResolve.mockResolvedValue(undefined);
});

describe('ReadingDetailScreen photo', () => {
  // The bug: a server-side photo rendered a placeholder and nothing else ever
  // tried to fetch it.
  it('renders a server photo once the cache resolves it', async () => {
    mockReadings.current = [reading({ s3Key: SIGNED_URL })];
    mockResolve.mockResolvedValue('file:///cache/bp-images/users_u1_readings_abc.jpg');

    const view = await renderScreen(<ReadingDetailScreen />);

    await waitFor(() => expect(view.getByTestId('reading-image')).toBeOnTheScreen());
    expect(view.queryByTestId('reading-image-placeholder')).toBeNull();
  });

  it('passes the signed URL to the cache rather than rendering it directly', async () => {
    mockReadings.current = [reading({ s3Key: SIGNED_URL })];

    await renderScreen(<ReadingDetailScreen />);

    expect(mockResolve).toHaveBeenCalledWith(SIGNED_URL);
  });

  // A local file needs no network and never expires, so it wins over the
  // signed URL when the same reading carries both.
  it('prefers the local file over the signed URL', async () => {
    mockReadings.current = [
      reading({ imageUri: 'file:///local/photo.jpg', s3Key: SIGNED_URL }),
    ];

    await renderScreen(<ReadingDetailScreen />);

    expect(mockResolve).toHaveBeenCalledWith('file:///local/photo.jpg');
    expect(mockResolve).not.toHaveBeenCalledWith(SIGNED_URL);
  });

  // `undefined` back from the cache means the download failed — an expired
  // signature, or offline with nothing cached. Keeping the dead URL on screen
  // would render a permanently broken image instead of an explanation.
  it('falls back to the placeholder when the cache cannot resolve', async () => {
    mockReadings.current = [reading({ s3Key: SIGNED_URL })];
    mockResolve.mockResolvedValue(undefined);

    const view = await renderScreen(<ReadingDetailScreen />);

    await waitFor(() =>
      expect(view.getByTestId('reading-image-placeholder')).toBeOnTheScreen(),
    );
    expect(view.getByText(/ลองใหม่อีกครั้งเมื่อเชื่อมต่ออินเทอร์เน็ต/)).toBeTruthy();
  });

  // Distinct copy from the one above: this reading genuinely has no photo, and
  // telling the user to reconnect would send them chasing nothing.
  it('says there is no photo when the reading never had one', async () => {
    mockReadings.current = [reading()];

    const view = await renderScreen(<ReadingDetailScreen />);

    expect(view.getByText(/ยังไม่มีรูปเครื่องวัดความดัน/)).toBeTruthy();
    // Nothing to resolve, so the cache is never asked — no directory is
    // created and no request is made for a reading that has no photo.
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
