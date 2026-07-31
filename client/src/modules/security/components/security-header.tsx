/**
 * The back bar every security screen shares.
 *
 * Extracted rather than repeated five times: the back affordance is the only
 * way out of these screens on iOS, and five copies is five chances for one to
 * drift or lose its accessibility label.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Text, TouchableOpacity, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';

export function SecurityHeader({ title }: { title: string }) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <View className="flex-row items-center px-4 py-4">
      <TouchableOpacity
        onPress={() => router.back()}
        className="mr-4 items-center justify-center"
        // 48dp hit area around a 28px glyph.
        style={{ minWidth: 48, minHeight: 48 }}
        accessibilityRole="button"
        accessibilityLabel="ย้อนกลับ"
      >
        <Ionicons name="arrow-back" size={28} color={colors['text-primary']} />
      </TouchableOpacity>

      <Text
        className="flex-1 text-center font-bold"
        numberOfLines={1}
        style={{ fontSize: Math.round(20 * fontScale), color: colors['text-primary'] }}
      >
        {title}
      </Text>

      {/* Balances the back button so the title stays optically centred. */}
      <View style={{ width: 48 }} />
    </View>
  );
}
