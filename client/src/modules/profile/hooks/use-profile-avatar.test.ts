/**
 * Changing the profile photo: pick or shoot → presigned S3 PUT → save the key.
 *
 * Four properties, and every one of them is only visible in a failing run.
 *
 * **The permission asked has to match the source.** Asking for the camera
 * before opening the library is a system dialog the user cannot make sense of,
 * and on Android it is a permission the app has no reason to hold.
 *
 * **The optimistic preview must be dropped when the upload fails.** It is set
 * before a three-hop round trip, so leaving it up tells the user a photo was
 * saved that never left the phone — and the next screen they open shows the
 * old avatar, with nothing to explain the difference.
 *
 * **`updateProfile` may write `avatar` and nothing else.** It overwrites what
 * it is given (`auth-api.ts`), so an extra key here silently rewrites a column
 * this hook has no business touching.
 *
 * **The crop is square.** Every surface renders an avatar in a circle, so a
 * wide crop guarantees a bad result — and the picker options are the only
 * place that is decided.
 *
 * `@/modules/auth` is replaced rather than mounted: `useUpdateProfile` needs a
 * `QueryClientProvider` and a transport, and what matters here is only which
 * fields reach it. `use-update-profile.test.ts` owns the cache write itself.
 */
const mockPicker = {
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
};
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: (...a: unknown[]) => mockPicker.requestCameraPermissionsAsync(...a),
  requestMediaLibraryPermissionsAsync: (...a: unknown[]) =>
    mockPicker.requestMediaLibraryPermissionsAsync(...a),
  launchCameraAsync: (...a: unknown[]) => mockPicker.launchCameraAsync(...a),
  launchImageLibraryAsync: (...a: unknown[]) => mockPicker.launchImageLibraryAsync(...a),
}));

const mockUpdateProfile = jest.fn();
jest.mock('@/modules/auth', () => ({
  useUpdateProfile: () => ({
    updateProfile: (...a: unknown[]) => mockUpdateProfile(...a),
    isPending: false,
    error: null,
    reset: () => {},
  }),
}));

const mockUploadImageViaPresign = jest.fn();
jest.mock('@/services/upload-image', () => ({
  uploadImageViaPresign: (...a: unknown[]) => mockUploadImageViaPresign(...a),
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { ApiError } from '@/services/api-error';

import { useProfileAvatar, type AvatarSource } from './use-profile-avatar';

const PICKED = 'file:///tmp/avatar.jpg';
const STORED = 'https://cdn.example.com/profile/u1.jpg';

const granted = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
const denied = { granted: false, status: 'denied', canAskAgain: false, expires: 'never' };
const picked = { canceled: false, assets: [{ uri: PICKED }] };

let alertSpy: jest.SpyInstance;

const render = () => renderHook(() => useProfileAvatar());

const change = async (
  view: Awaited<ReturnType<typeof render>>,
  source: AvatarSource = 'library',
) => {
  await act(async () => {
    await view.result.current.changeAvatar(source);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` empties the call log but leaves implementations and any
  // `mockResolvedValueOnce` queue in place for the next test to consume.
  for (const fn of Object.values(mockPicker)) fn.mockReset();
  mockUpdateProfile.mockReset();
  mockUploadImageViaPresign.mockReset();

  mockPicker.requestCameraPermissionsAsync.mockResolvedValue(granted);
  mockPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue(granted);
  mockPicker.launchCameraAsync.mockResolvedValue(picked);
  mockPicker.launchImageLibraryAsync.mockResolvedValue(picked);
  mockUploadImageViaPresign.mockResolvedValue({ url: STORED, key: 'profile/u1.jpg', imageId: 4 });
  mockUpdateProfile.mockResolvedValue({ id: 'u1', avatar: STORED });

  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('the permission it asks for', () => {
  it('asks the library for a library pick, and never the camera', async () => {
    const view = await render();
    await change(view, 'library');

    expect(mockPicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
    // The negative half: a camera prompt in front of a library pick is a
    // dialog the user cannot connect to what they tapped.
    expect(mockPicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks the camera for a camera shot, and never the library', async () => {
    const view = await render();
    await change(view, 'camera');

    expect(mockPicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockPicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('when the permission is refused', () => {
  it('explains which permission, in Thai, and opens nothing', async () => {
    mockPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue(denied);

    const view = await render();
    await change(view, 'library');

    expect(alertSpy).toHaveBeenCalledWith(
      'ต้องการสิทธิ์เข้าถึงรูปภาพ',
      'กรุณาอนุญาตในตั้งค่าของเครื่อง แล้วลองใหม่อีกครั้ง',
    );
    // An `Alert` here rather than the inline banner is the deliberate
    // carve-out in the "errors are inline" rule — so `error` stays null and
    // the screen shows nothing of its own.
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.localPreview).toBeNull();
    expect(mockPicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(mockUploadImageViaPresign).not.toHaveBeenCalled();
  });

  it('names the camera when it is the camera that was refused', async () => {
    mockPicker.requestCameraPermissionsAsync.mockResolvedValue(denied);

    const view = await render();
    await change(view, 'camera');

    // Two sources, two titles. A shared string would send a user to the
    // wrong switch in the system settings.
    expect(alertSpy).toHaveBeenCalledWith(
      'ต้องการสิทธิ์ใช้กล้อง',
      'กรุณาอนุญาตในตั้งค่าของเครื่อง แล้วลองใหม่อีกครั้ง',
    );
    expect(mockPicker.launchCameraAsync).not.toHaveBeenCalled();
  });
});

describe('the picker options', () => {
  it('crops square, at the quality both entry points share', async () => {
    const view = await render();
    await change(view, 'library');

    // `aspect: [1, 1]` is the load-bearing one: every surface that renders an
    // avatar crops it to a circle, so a wide crop is a guaranteed bad result
    // and there is nothing downstream that could correct it.
    expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
  });

  it('hands the camera the identical object, not a second set of options', async () => {
    const view = await render();
    await change(view, 'library');
    await change(view, 'camera');

    // Reference equality, not a matching literal: `PICKER_OPTIONS` is one
    // module-level constant, and two copies would let the square crop drift
    // between "take a photo" and "choose from library" — which is precisely
    // the split `avatar-picker.tsx` already has to keep in step.
    expect(mockPicker.launchCameraAsync.mock.calls[0][0]).toBe(
      mockPicker.launchImageLibraryAsync.mock.calls[0][0],
    );
  });
});

describe('when the user backs out', () => {
  it('uploads nothing after a cancel', async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });

    const view = await render();
    await change(view, 'library');

    expect(mockUploadImageViaPresign).not.toHaveBeenCalled();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    // No preview either: showing one for a photo that was never picked would
    // leave a stranger's avatar on screen until the next fetch.
    expect(view.result.current.localPreview).toBeNull();
    expect(view.result.current.isUploading).toBe(false);
  });

  it('uploads nothing when the picker returns without an asset', async () => {
    // `canceled: false` with an empty list — the shape the type permits and
    // the hook guards against with `result.assets[0]?.uri`.
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [] });

    const view = await render();
    await change(view, 'library');

    expect(mockUploadImageViaPresign).not.toHaveBeenCalled();
    expect(view.result.current.localPreview).toBeNull();
  });
});

describe('the upload', () => {
  it('sends the picked file under the PROFILE kind', async () => {
    const view = await render();
    await change(view, 'library');

    // `kind` picks the S3 prefix and the gateway's size limit. A reading's
    // photo and an avatar are not interchangeable.
    expect(mockUploadImageViaPresign).toHaveBeenCalledWith({ uri: PICKED, kind: 'PROFILE' });
  });

  it('saves the returned url as `avatar`, and writes no other field', async () => {
    const view = await render();
    await change(view, 'library');

    // `toHaveBeenCalledWith` on the whole object. `updateProfile` writes
    // every key it is handed, so a stray `firstname` here would overwrite a
    // name the user is editing on the same screen.
    expect(mockUpdateProfile).toHaveBeenCalledWith({ avatar: STORED });
  });

  it('shows the local file while the round trip is in flight, and keeps it after', async () => {
    let release: (value: { url: string }) => void = () => {};
    mockUploadImageViaPresign.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>((resolve) => {
          release = resolve;
        }),
    );

    const view = await render();
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = view.result.current.changeAvatar('library');
    });

    // The whole reason the preview exists: `uploadImageViaPresign` is three
    // hops on a camera photo, and an unchanged avatar for those seconds reads
    // as "the tap didn't work" and invites a second tap.
    expect(view.result.current.localPreview).toBe(PICKED);
    expect(view.result.current.isUploading).toBe(true);

    await act(async () => {
      release({ url: STORED });
      await pending;
    });

    // Still up on success. The stored avatar only appears once the `me` query
    // carries it, and dropping the preview at this moment would flash the old
    // photo back in between.
    expect(view.result.current.localPreview).toBe(PICKED);
    expect(view.result.current.isUploading).toBe(false);
    expect(view.result.current.error).toBeNull();
  });
});

describe('when it fails', () => {
  it('drops the preview and says so, rather than showing a photo that never left', async () => {
    mockUploadImageViaPresign.mockRejectedValue(
      new ApiError('S3 PUT failed with 403', { code: 'UPLOAD_FAILED', httpStatus: 403 }),
    );

    const view = await render();
    await change(view, 'library');

    // Back to whatever is actually stored. This is the assertion the hook's
    // own comment asks for.
    expect(view.result.current.localPreview).toBeNull();
    expect(view.result.current.error).toBe('อัปโหลดรูปโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่');
    expect(view.result.current.isUploading).toBe(false);
  });

  it('drops the preview when the upload lands but the profile write does not', async () => {
    mockUpdateProfile.mockRejectedValue(new ApiError('[CONFLICT] no', { code: 'CONFLICT' }));

    const view = await render();
    await change(view, 'library');

    // The bytes are in S3 but nothing points at them. Keeping the preview
    // would show a saved avatar that no other device will ever see.
    expect(view.result.current.localPreview).toBeNull();
    expect(view.result.current.error).not.toBeNull();
  });

  it('does not reject — the screen has nothing to catch', async () => {
    mockUploadImageViaPresign.mockRejectedValue(new Error('boom'));

    const view = await render();

    // The `try/catch` swallows it on purpose: the failure is reported through
    // `error`, and a rejection here would be an unhandled one at every call
    // site, none of which awaits this.
    await expect(view.result.current.changeAvatar('library')).resolves.toBeUndefined();
  });

  it('clears the banner on dismiss', async () => {
    mockUploadImageViaPresign.mockRejectedValue(new Error('boom'));

    const view = await render();
    await change(view, 'library');
    expect(view.result.current.error).not.toBeNull();

    await act(async () => {
      view.result.current.clearError();
    });

    expect(view.result.current.error).toBeNull();
  });

  it('clears the previous banner before the retry, not after it resolves', async () => {
    mockUploadImageViaPresign.mockRejectedValueOnce(new Error('boom'));

    const view = await render();
    await change(view, 'library');
    expect(view.result.current.error).not.toBeNull();

    let release: (value: { url: string }) => void = () => {};
    mockUploadImageViaPresign.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>((resolve) => {
          release = resolve;
        }),
    );

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = view.result.current.changeAvatar('library');
    });

    // Observed while the retry is open, driven from the test across an `act`
    // boundary. `setError(null)` is the first line of `change`, so a failure
    // banner sitting over a request in flight is exactly what it prevents —
    // and no assertion taken after the call has settled can see it.
    expect(view.result.current.error).toBeNull();

    await act(async () => {
      release({ url: STORED });
      await pending;
    });

    await waitFor(() => expect(view.result.current.isUploading).toBe(false));
    expect(view.result.current.error).toBeNull();
  });
});
