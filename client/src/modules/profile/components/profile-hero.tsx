/**
 * Avatar, name, and role at the top of the profile screen.
 *
 * The photo is tappable at all times, not only in edit mode. Changing it is
 * its own immediate action (see `use-profile-avatar.ts`), and hiding it
 * behind "แก้ไข" made the most-wanted change on the screen the one with the
 * most steps.
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import type { UserRole } from '@/modules/auth';

const ROLE_LABEL: Record<UserRole, string> = {
  patient: 'ผู้ป่วย',
  caregiver: 'ผู้ดูแล',
  developer: 'นักพัฒนา',
};

export type ProfileHeroProps = {
  firstname: string;
  lastname: string;
  avatarUri?: string | null;
  role?: UserRole;
  isUploading?: boolean;
  onChangeAvatar: () => void;
};

export function ProfileHero({
  firstname,
  lastname,
  avatarUri,
  role,
  isUploading = false,
  onChangeAvatar,
}: ProfileHeroProps) {
  const colors = useTheme();
  const fontScale = useFontScale();

  const fullName = `${firstname} ${lastname}`.trim();

  return (
    <View className="items-center px-4 pb-2 pt-2">
      <Pressable
        testID="profile-avatar"
        onPress={onChangeAvatar}
        disabled={isUploading}
        accessibilityRole="button"
        accessibilityLabel="เปลี่ยนรูปโปรไฟล์"
        accessibilityState={{ busy: isUploading }}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <View>
          <Avatar uri={avatarUri} firstname={firstname} lastname={lastname} size="xl" />

          {isUploading ? (
            <View
              className="absolute inset-0 items-center justify-center rounded-full"
              style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            >
              <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
          ) : (
            <View
              className="absolute -bottom-1 -right-1 h-7 w-7 items-center justify-center rounded-full border-2"
              style={{ backgroundColor: colors.primary, borderColor: colors.surface }}
            >
              <Ionicons name="camera" size={14} color="#FFFFFF" />
            </View>
          )}
        </View>
      </Pressable>

      <Text
        className="mt-3 text-center font-bold"
        style={{ fontSize: Math.round(20 * fontScale), color: colors['text-primary'] }}
      >
        {fullName || 'ยังไม่ได้ตั้งชื่อ'}
      </Text>

      {role ? (
        <View
          className="mt-2 rounded-full px-3 py-1"
          style={{ backgroundColor: colors['surface-muted'] }}
        >
          <Text
            className="font-semibold"
            style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
          >
            {ROLE_LABEL[role]}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
