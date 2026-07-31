/**
 * Ported from client-old/app/about.tsx: app identity, description, feature
 * list, external links, and credits.
 *
 * One deliberate change: client-old's logo was a placeholder Tux (Linux
 * mascot) SVG fetched from Wikipedia — never real branding, just an unset
 * asset. Swapped for the same heart-circle mark `AuthShell` already uses as
 * this app's actual identity, rather than porting a placeholder as if it
 * were real. Everything else — version string, links, copyright year — is
 * client-old's own content, carried over verbatim rather than invented.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { palette } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: 'camera', label: 'ถ่ายภาพเครื่องวัดความดัน' },
  { icon: 'trending-up', label: 'วิเคราะห์แนวโน้มความดัน' },
  { icon: 'document-text', label: 'สร้างรายงาน PDF' },
  { icon: 'notifications', label: 'แจ้งเตือนวัดความดัน' },
  { icon: 'people', label: 'ชุมชนแลกเปลี่ยนความรู้' },
];

const LINKS: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  url: string;
}[] = [
  {
    icon: 'shield-outline',
    label: 'นโยบายความเป็นส่วนตัว',
    url: 'https://example.com/privacy',
  },
  {
    icon: 'document-outline',
    label: 'เงื่อนไขการใช้งาน',
    url: 'https://example.com/terms',
  },
  {
    icon: 'logo-github',
    label: 'GitHub Repository',
    url: 'https://github.com',
  },
];

export default function AboutScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { scheme } = useColorSchemePreference();
  const isDark = scheme === 'dark';

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center px-4 py-4">
          <Pressable
            onPress={() => router.back()}
            className="mr-4"
            accessibilityRole="button"
            accessibilityLabel="ย้อนกลับ"
          >
            <Ionicons
              name="arrow-back"
              size={28}
              color={colors['text-primary']}
            />
          </Pressable>
          <Text
            className="flex-1 text-center font-bold"
            style={{
              fontSize: Math.round(19 * fontScale),
              color: colors['text-primary'],
            }}
          >
            เกี่ยวกับ
          </Text>
          <View className="w-7" />
        </View>

        {/* App identity */}
        <View className="items-center py-8">
          <View
            className="mb-4 h-24 w-24 items-center justify-center rounded-2xl border"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: isDark ? 0 : 0.1,
              shadowRadius: 10,
              elevation: isDark ? 0 : 4,
            }}
          >
            <Ionicons name="heart-circle" size={56} color="#E91E63" />
          </View>
          <Text
            className="font-bold"
            style={{
              fontSize: Math.round(19 * fontScale),
              color: colors['text-primary'],
            }}
          >
            BP Monitor
          </Text>
          <Text
            style={{
              fontSize: Math.round(15 * fontScale),
              color: colors['text-secondary'],
            }}
          >
            เวอร์ชัน 1.0.0
          </Text>
        </View>

        {/* Description */}
        <View className="mb-6 px-4">
          <View
            className="rounded-xl border p-4"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                fontSize: Math.round(15 * fontScale),
                lineHeight: Math.round(15 * fontScale * 1.6),
                color: colors['text-primary'],
              }}
            >
              แอปพลิเคชั่นสำหรับบันทึกและติดตามค่าความดันโลหิตของคุณ
              ช่วยให้คุณดูแลสุขภาพได้อย่างมีประสิทธิภาพด้วยการวิเคราะห์แนวโน้ม
              และรายงานที่เข้าใจง่าย
            </Text>
          </View>
        </View>

        {/* Features */}
        <View className="mb-6 px-4">
          <Text
            className="mb-3 font-bold"
            style={{
              fontSize: Math.round(17 * fontScale),
              color: colors['text-primary'],
            }}
          >
            ฟีเจอร์หลัก
          </Text>
          <View
            className="rounded-xl border p-4"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
            }}
          >
            {FEATURES.map((feature, index) => (
              <View
                key={feature.label}
                className={`flex-row items-center ${index < FEATURES.length - 1 ? 'mb-3' : ''}`}
              >
                <Ionicons name={feature.icon} size={20} color={palette.blue} />
                <Text
                  className="ml-3"
                  style={{
                    fontSize: Math.round(15 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  {feature.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Links */}
        <View className="mb-6 px-4">
          <Text
            className="mb-3 font-bold"
            style={{
              fontSize: Math.round(17 * fontScale),
              color: colors['text-primary'],
            }}
          >
            ข้อมูลเพิ่มเติม
          </Text>
          {LINKS.map((link, index) => (
            <Pressable
              key={link.label}
              onPress={() => Linking.openURL(link.url)}
              className={`flex-row items-center rounded-xl border p-4 ${index < LINKS.length - 1 ? 'mb-3' : ''}`}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
              }}
            >
              <Ionicons name={link.icon} size={22} color={palette.blue} />
              <Text
                className="ml-3 flex-1"
                style={{
                  fontSize: Math.round(15 * fontScale),
                  color: colors['text-primary'],
                }}
              >
                {link.label}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors['text-secondary']}
              />
            </Pressable>
          ))}
        </View>

        {/* Credits */}
        <View className="mb-8 px-4">
          <View
            className="rounded-xl border p-4"
            style={{
              backgroundColor: isDark ? '#1E1B4B' : '#F5F3FF',
              borderColor: isDark ? '#3730A3' : '#DDD6FE',
            }}
          >
            <Text
              className="text-center font-medium"
              style={{
                fontSize: Math.round(15 * fontScale),
                color: isDark ? '#E0E7FF' : '#6D28D9',
              }}
            >
              พัฒนาโดย ทีมพัฒนา BP Monitor
            </Text>
            <Text
              className="mt-1 text-center"
              style={{
                fontSize: Math.round(15 * fontScale),
                color: isDark ? '#C7D2FE' : '#7C3AED',
              }}
            >
              © 2025 All Rights Reserved
            </Text>
          </View>
        </View>
      </ScrollView>
    </GradientBackground>
  );
}
