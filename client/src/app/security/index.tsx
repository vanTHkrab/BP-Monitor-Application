/**
 * Security hub.
 *
 * Ported from client-old/app/security.tsx, but restructured: the old screen
 * put a password form, two switches, a session list, and a danger action on
 * one scroll. That works when there are four things. This account now also
 * has passkeys, an app lock, and a Google link, and stacking all of it would
 * make the screen a wall the user has to read to find one setting.
 *
 * So the hub answers first (`assessSecurity`) and routes second. Every control
 * from the old screen is still reachable — one tap further, in a place where
 * it has room to explain itself.
 */
import { router } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useLoginSessions, useSession } from '@/modules/auth';
import {
  useAppLock,
  useSecurityOverview,
  SecurityGroup,
  SecurityHeader,
  SecurityRow,
  SecurityPostureBanner,
  assessSecurity,
  describeLoginMethod,
} from '@/modules/security';

export default function SecurityScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { user } = useSession();
  const { overview, isLoading, refetch } = useSecurityOverview();
  const { sessions } = useLoginSessions();
  const appLock = useAppLock();

  const appLockEnabled = appLock.enabled === true;
  const posture = overview ? assessSecurity(overview, appLockEnabled) : null;

  const activeSessions = overview?.activeSessionCount ?? sessions.filter((s) => s.isActive).length;

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="ความปลอดภัย" />

        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={() => void refetch()} />
          }
        >
          {posture ? (
            <SecurityPostureBanner
              posture={posture}
              onAction={() => posture.actionRoute && router.push(posture.actionRoute)}
            />
          ) : (
            <LoadingBanner />
          )}

          <SecurityGroup title="วิธีเข้าสู่ระบบ">
            <SecurityRow
              testID="security-last-login"
              icon="time-outline"
              title="เข้าสู่ระบบล่าสุดด้วย"
              value={describeLoginMethod(overview?.lastLoginMethod)}
            />
            <SecurityRow
              testID="security-password"
              icon="key-outline"
              title="รหัสผ่าน"
              value={overview?.hasPassword ? 'ตั้งไว้แล้ว' : 'ยังไม่ได้ตั้ง'}
              tone={overview?.hasPassword ? 'neutral' : 'attention'}
              onPress={() => router.push('/security/password')}
            />
            {overview?.passkeySupported ? (
              <SecurityRow
                testID="security-passkeys"
                icon="finger-print-outline"
                title="Passkey"
                value={
                  overview.passkeyCount > 0
                    ? `${overview.passkeyCount} รายการ`
                    : 'ยังไม่ได้เพิ่ม'
                }
                tone={overview.passkeyCount > 0 ? 'good' : 'neutral'}
                onPress={() => router.push('/security/passkeys')}
              />
            ) : null}
            <SecurityRow
              testID="security-google"
              icon="logo-google"
              title="บัญชี Google"
              value={overview?.hasGoogleAccount ? 'เชื่อมแล้ว' : 'ยังไม่ได้เชื่อม'}
              tone={overview?.hasGoogleAccount ? 'good' : 'neutral'}
              isLast
            />
          </SecurityGroup>

          <SecurityGroup title="อุปกรณ์และการเข้าถึง">
            <SecurityRow
              testID="security-devices"
              icon="phone-portrait-outline"
              title="อุปกรณ์ที่เข้าสู่ระบบ"
              value={`${activeSessions} เครื่อง`}
              onPress={() => router.push('/security/devices')}
            />
            <SecurityRow
              testID="security-app-lock"
              icon="lock-closed-outline"
              title="ล็อกแอป"
              value={appLockEnabled ? 'เปิดอยู่' : 'ปิดอยู่'}
              tone={appLockEnabled ? 'good' : 'neutral'}
              hint={
                appLock.capability && !appLock.capability.available
                  ? 'ต้องตั้งค่าการปลดล็อกในเครื่องก่อน'
                  : undefined
              }
              onPress={() => router.push('/security/app-lock')}
              isLast
            />
          </SecurityGroup>

          {user?.email && overview && !overview.emailVerified ? (
            <SecurityGroup title="อีเมล">
              <SecurityRow
                testID="security-verify-email"
                icon="mail-unread-outline"
                title="ยืนยันอีเมล"
                value="ยังไม่ได้ยืนยัน"
                tone="attention"
                hint="ยืนยันแล้วจึงจะเชื่อมบัญชี Google ได้"
                onPress={() => router.push('/verify-email')}
                isLast
              />
            </SecurityGroup>
          ) : null}

          <Text
            className="mb-8 mt-8 px-2 text-center"
            style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
          >
            การเปลี่ยนรหัสผ่านจะทำให้อุปกรณ์เครื่องอื่นออกจากระบบทั้งหมด
            แต่เครื่องนี้จะยังใช้งานต่อได้
          </Text>
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

/**
 * Holds the banner's height while the overview loads, so the rows below do not
 * jump down the moment it arrives.
 */
function LoadingBanner() {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <View
      className="mt-2 justify-center rounded-2xl px-5"
      style={{ backgroundColor: colors.surface, minHeight: 116 }}
    >
      <Text style={{ fontSize: Math.round(15 * fontScale), color: colors['text-secondary'] }}>
        กำลังตรวจสอบสถานะความปลอดภัย…
      </Text>
    </View>
  );
}
