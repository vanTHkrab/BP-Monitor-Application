/**
 * Read-only profile avatar: signed image when there is one, initials
 * otherwise. Ported concept from client-old/components/ui/avatar.tsx, sized
 * down to what this tree currently needs — no `UIImage` wrapper yet, so this
 * goes straight to `expo-image`, matching `avatar-picker.tsx`'s pattern.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_PX: Record<AvatarSize, number> = { sm: 36, md: 48, lg: 64, xl: 96 };
const ICON_SIZE: Record<AvatarSize, number> = { sm: 18, md: 24, lg: 32, xl: 48 };
const INITIALS_FONT: Record<AvatarSize, number> = { sm: 14, md: 18, lg: 24, xl: 32 };

function initialsOf(firstname?: string, lastname?: string): string | null {
  const first = firstname?.trim()?.[0];
  const last = lastname?.trim()?.[0];
  const initials = `${first ?? ''}${last ?? ''}`.toUpperCase();
  return initials || null;
}

export type AvatarProps = {
  uri?: string | null;
  firstname?: string;
  lastname?: string;
  size?: AvatarSize;
};

export function Avatar({ uri, firstname, lastname, size = 'md' }: AvatarProps) {
  const colors = useTheme();
  const fontScale = useFontScale();
  const boxSize = SIZE_PX[size];
  const initials = initialsOf(firstname, lastname);

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: boxSize, height: boxSize, borderRadius: boxSize / 2 }}
        contentFit="cover"
        accessibilityLabel={
          firstname ? `รูปโปรไฟล์ของ ${firstname}` : 'รูปโปรไฟล์'
        }
      />
    );
  }

  return (
    <View
      style={{
        width: boxSize,
        height: boxSize,
        borderRadius: boxSize / 2,
        backgroundColor: colors['surface-muted'],
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityLabel={
        firstname ? `รูปโปรไฟล์ของ ${firstname}` : 'รูปโปรไฟล์'
      }
    >
      {initials ? (
        <Text
          style={{
            fontSize: Math.round(INITIALS_FONT[size] * fontScale),
            fontWeight: '700',
            color: colors['text-secondary'],
          }}
        >
          {initials}
        </Text>
      ) : (
        <Ionicons
          name="person"
          size={ICON_SIZE[size]}
          color={colors['text-secondary']}
        />
      )}
    </View>
  );
}
