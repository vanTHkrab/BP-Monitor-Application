/**
 * Ported from client-old/app/help.tsx: contact rows, an FAQ list, two CTA
 * tiles, and a tutorial banner. Static content — no store dependency beyond
 * theme/font, both of which this tree already has (`useTheme`,
 * `useFontScale`) in place of client-old's `Colors` constant and
 * `fontPresetClass`.
 *
 * Contact details (email, phone, Line) and the FAQ copy are client-old's
 * own placeholder content, carried over verbatim rather than invented here.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { palette } from '@/theme';

const FAQ_ITEMS = [
  {
    question: 'วิธีการถ่ายภาพเครื่องวัดความดัน?',
    answer:
      'วางเครื่องวัดความดันให้หน้าจอแสดงผลอยู่ในกรอบสี่เหลี่ยม จากนั้นกดปุ่มถ่ายภาพ แอปจะอ่านค่าจากภาพโดยอัตโนมัติ',
  },
  {
    question: 'ค่าความดันปกติอยู่ที่เท่าไหร่?',
    answer:
      'ค่าความดันปกติอยู่ที่ต่ำกว่า 120/80 mmHg หากค่าความดันของคุณสูงกว่านี้ ควรปรึกษาแพทย์',
  },
  {
    question: 'ควรวัดความดันบ่อยแค่ไหน?',
    answer:
      'สำหรับผู้ที่มีความดันปกติ แนะนำให้วัดอย่างน้อยปีละ 1 ครั้ง หากมีความดันสูงควรวัดทุกวันตามคำแนะนำของแพทย์',
  },
  {
    question: 'ข้อมูลของฉันปลอดภัยหรือไม่?',
    answer:
      'ข้อมูลของคุณถูกเข้ารหัสและจัดเก็บอย่างปลอดภัย เราไม่แชร์ข้อมูลกับบุคคลที่สามโดยไม่ได้รับอนุญาต',
  },
];

export default function HelpScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();

  const contactDeveloper = () =>
    Linking.openURL(
      'mailto:support@bpapp.com?subject=BP%20Mobile%20-%20ติดต่อผู้พัฒนา',
    );

  const reportProblem = () =>
    Linking.openURL(
      'mailto:support@bpapp.com?subject=BP%20Mobile%20-%20รายงานปัญหา&body=อธิบายปัญหา:%0A%0Aรุ่นแอป:%0Aรุ่นเครื่อง/OS:%0Aแนบรูปหรือขั้นตอนที่ทำให้เกิดปัญหา:%0A',
    );

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
            ช่วยเหลือและคำแนะนำ
          </Text>
          <View className="w-7" />
        </View>

        {/* Contact */}
        <View className="mb-6 px-4">
          <Text
            className="mb-3 font-bold"
            style={{
              fontSize: Math.round(17 * fontScale),
              color: colors['text-primary'],
            }}
          >
            ติดต่อเรา
          </Text>

          <Pressable
            onPress={contactDeveloper}
            className="mb-3 flex-row items-center rounded-xl border p-4"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
            }}
          >
            <View
              className="mr-3 h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: colors['surface-muted'] }}
            >
              <Ionicons name="mail-outline" size={22} color={palette.blue} />
            </View>
            <View className="flex-1">
              <Text
                className="font-medium"
                style={{
                  fontSize: Math.round(15 * fontScale),
                  color: colors['text-primary'],
                }}
              >
                อีเมล
              </Text>
              <Text
                style={{
                  fontSize: Math.round(15 * fontScale),
                  color: colors['text-secondary'],
                }}
              >
                support@bpapp.com
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => Linking.openURL('tel:02-123-4567')}
            className="mb-3 flex-row items-center rounded-xl border p-4"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
            }}
          >
            <View
              className="mr-3 h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: colors['surface-muted'] }}
            >
              <Ionicons name="call-outline" size={22} color={palette.blue} />
            </View>
            <View className="flex-1">
              <Text
                className="font-medium"
                style={{
                  fontSize: Math.round(15 * fontScale),
                  color: colors['text-primary'],
                }}
              >
                โทรศัพท์
              </Text>
              <Text
                style={{
                  fontSize: Math.round(15 * fontScale),
                  color: colors['text-secondary'],
                }}
              >
                02-123-4567
              </Text>
            </View>
          </Pressable>

          <View
            className="flex-row items-center rounded-xl border p-4"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
            }}
          >
            <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-green-100">
              <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
            </View>
            <View className="flex-1">
              <Text
                className="font-medium"
                style={{
                  fontSize: Math.round(15 * fontScale),
                  color: colors['text-primary'],
                }}
              >
                Line Official
              </Text>
              <Text
                style={{
                  fontSize: Math.round(15 * fontScale),
                  color: colors['text-secondary'],
                }}
              >
                @bpapp
              </Text>
            </View>
          </View>
        </View>

        {/* FAQ */}
        <View className="px-4">
          <Text
            className="mb-3 font-bold"
            style={{
              fontSize: Math.round(17 * fontScale),
              color: colors['text-primary'],
            }}
          >
            คำถามที่พบบ่อย
          </Text>

          {FAQ_ITEMS.map((item) => (
            <View
              key={item.question}
              className="mb-3 rounded-xl border p-4"
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
              }}
            >
              <View className="mb-2 flex-row items-start">
                <Ionicons name="help-circle" size={20} color={palette.blue} />
                <Text
                  className="ml-2 flex-1 font-medium"
                  style={{
                    fontSize: Math.round(15 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  {item.question}
                </Text>
              </View>
              <Text
                className="ml-7"
                style={{
                  fontSize: Math.round(15 * fontScale),
                  lineHeight: Math.round(15 * fontScale * 1.6),
                  color: colors['text-secondary'],
                }}
              >
                {item.answer}
              </Text>
            </View>
          ))}
        </View>

        {/* Developer contact tiles */}
        <View className="mt-4 px-4">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={contactDeveloper}
              className="mr-3 flex-1 overflow-hidden rounded-2xl"
            >
              <View className="min-h-[140px] items-center justify-center bg-teal-700 p-6">
                <Ionicons name="mail-outline" size={40} color="#FFFFFF" />
                <Text
                  className="mt-3 text-center font-bold text-white"
                  style={{ fontSize: Math.round(17 * fontScale) }}
                >
                  ติดต่อผู้พัฒนา
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={reportProblem}
              className="flex-1 overflow-hidden rounded-2xl"
            >
              <View className="min-h-[140px] items-center justify-center bg-cyan-700 p-6">
                <Ionicons name="megaphone-outline" size={40} color="#FFFFFF" />
                <Text
                  className="mt-3 text-center font-bold text-white"
                  style={{ fontSize: Math.round(17 * fontScale) }}
                >
                  ส่งรายงานปัญหา
                </Text>
              </View>
            </Pressable>
          </View>

          <Text
            className="mt-3"
            style={{
              fontSize: Math.round(15 * fontScale),
              lineHeight: Math.round(15 * fontScale * 1.6),
              color: colors['text-secondary'],
            }}
          >
            หากพบปัญหาในการใช้งาน สามารถส่งอีเมลถึงผู้พัฒนาได้
          </Text>
        </View>

        {/* Tutorial */}
        <View className="mb-8 mt-4 px-4">
          <View
            className="flex-row items-center rounded-xl p-4"
            style={{ backgroundColor: palette.purple }}
          >
            <Ionicons name="play-circle" size={32} color="#FFFFFF" />
            <View className="ml-3 flex-1">
              <Text
                className="font-bold text-white"
                style={{ fontSize: Math.round(15 * fontScale) }}
              >
                ดูวิดีโอสอนการใช้งาน
              </Text>
              <Text
                className="text-white/80"
                style={{ fontSize: Math.round(12 * fontScale) }}
              >
                เรียนรู้วิธีใช้แอปอย่างละเอียด
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#FFFFFF" />
          </View>
        </View>
      </ScrollView>
    </GradientBackground>
  );
}
