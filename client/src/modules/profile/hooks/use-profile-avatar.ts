/**
 * Change the profile photo: pick or shoot → presigned S3 PUT → save the key.
 *
 * Separate from the form's save button, and saved immediately rather than on
 * "บันทึก". A photo is one decision with visible feedback, and the old client
 * bundling it into the form meant a user who picked a photo and then hit
 * cancel silently discarded an upload that had already happened.
 *
 * The optimistic local preview is the point: `uploadImageViaPresign` is a
 * three-hop round trip on a phone camera photo, and showing the old avatar
 * for those seconds reads as "the tap didn't work" and invites a second tap.
 */
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert } from 'react-native';

import { useUpdateProfile } from '@/modules/auth';
import { uploadImageViaPresign } from '@/services/upload-image';

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  // Square, because every surface that renders an avatar crops it to a
  // circle — a wide crop guarantees a bad result. Same as `avatar-picker.tsx`.
  aspect: [1, 1],
  quality: 0.8,
};

export type AvatarSource = 'library' | 'camera';

export function useProfileAvatar() {
  const { updateProfile } = useUpdateProfile();
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [isUploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestPermission = async (source: AvatarSource): Promise<boolean> => {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permission.granted) return true;

    // Alert is right here: a permission prompt is exactly the case the
    // "errors are inline, not Alert" rule carves out.
    Alert.alert(
      source === 'camera' ? 'ต้องการสิทธิ์ใช้กล้อง' : 'ต้องการสิทธิ์เข้าถึงรูปภาพ',
      'กรุณาอนุญาตในตั้งค่าของเครื่อง แล้วลองใหม่อีกครั้ง',
    );
    return false;
  };

  const change = async (source: AvatarSource) => {
    setError(null);
    if (!(await requestPermission(source))) return;

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);

    const picked = result.canceled ? null : result.assets[0]?.uri;
    if (!picked) return;

    setLocalPreview(picked);
    setUploading(true);

    try {
      const uploaded = await uploadImageViaPresign({ uri: picked, kind: 'PROFILE' });
      await updateProfile({ avatar: uploaded.url });
    } catch {
      // Drop the preview so the avatar shows what is actually stored. Leaving
      // it up would tell the user a photo was saved that never left the phone.
      setLocalPreview(null);
      setError('อัปโหลดรูปโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setUploading(false);
    }
  };

  return {
    /** Show this over the stored avatar while it is in flight. */
    localPreview,
    isUploading,
    error,
    changeAvatar: change,
    clearError: () => setError(null),
  };
}
