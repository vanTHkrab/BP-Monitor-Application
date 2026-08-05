/**
 * App lock. Replaces client-old's two switches ("ซ่อนข้อมูลส่วนตัว" and
 * "ปลดล็อกด้วย Face ID") with the one setting they were both approximating.
 *
 * The old pair was confusing in a way worth naming: one hid data behind a
 * prompt on one screen, the other stored a preference that nothing enforced.
 * Two switches for one intention, neither of which locked the app. This is
 * that intention, done once and actually enforced by `AppLockGate`.
 *
 * Default off, and the copy says why it is optional rather than nagging.
 */
import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { useTheme } from '@/hooks/use-theme';
import {
  biometricErrorMessage,
  promptDeviceUnlock,
  useAppLock,
  SecurityGroup,
  SecurityHeader,
  SecurityRow,
} from '@/modules/security';
import { palette } from '@/theme';

export default function AppLockScreen() {
  const colors = useTheme();
  const { enabled, capability, setEnabled } = useAppLock();
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const available = capability?.available ?? false;
  const isOn = enabled === true;

  const handleToggle = async (next: boolean) => {
    if (isBusy) return;
    setMessage(null);

    if (!next) {
      // Turning it off asks for the unlock too. Otherwise anyone holding the
      // unlocked phone can disable the lock from inside the app, which makes
      // the lock decorative the moment someone gets past it once.
      setIsBusy(true);
      try {
        const ok = await promptDeviceUnlock('ยืนยันตัวตนเพื่อปิดล็อกแอป');
        if (ok) await setEnabled(false);
        else setMessage(biometricErrorMessage('authentication_failed'));
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (!available) {
      setMessage(
        'เครื่องนี้ยังไม่ได้ตั้งค่าการปลดล็อก กรุณาตั้ง PIN ลายนิ้วมือ หรือใบหน้า ในการตั้งค่าของเครื่องก่อน',
      );
      return;
    }

    setIsBusy(true);
    try {
      // Proving it works before switching it on: enabling a lock that then
      // cannot be satisfied would leave the user shut out of their own
      // readings on the next launch.
      const ok = await promptDeviceUnlock('ยืนยันตัวตนเพื่อเปิดล็อกแอป');
      if (ok) await setEnabled(true);
      else setMessage(biometricErrorMessage('authentication_failed'));
    } catch {
      setMessage(biometricErrorMessage());
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="ล็อกแอป" subject="self" />

        <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
          <View className="mt-2 rounded-2xl p-5" style={{ backgroundColor: colors.surface }}>
            <ThemedText type="bodyLarge" weight="bold">
              ให้ถามก่อนเปิดแอปทุกครั้ง
            </ThemedText>
            <ThemedText type="body" weight="regular" themeColor="text-secondary" className="mt-2">
              เหมาะกับเครื่องที่ใช้ร่วมกับคนอื่น ถ้าใช้เครื่องคนเดียว
              ไม่เปิดก็ได้ — ข้อมูลของคุณยังถูกป้องกันด้วยบัญชีอยู่แล้ว
            </ThemedText>
          </View>

          <SecurityGroup>
            <SecurityRow
              testID="app-lock-toggle"
              icon="lock-closed-outline"
              title="ล็อกแอป"
              value={isOn ? 'เปิดอยู่' : 'ปิดอยู่'}
              tone={isOn ? 'good' : 'neutral'}
              hint={
                available
                  ? `ปลดล็อกด้วย${capability?.label ?? 'ระบบล็อกหน้าจอ'}`
                  : 'ต้องตั้งค่าการปลดล็อกในเครื่องก่อน'
              }
              disabled={!available && !isOn}
              accessory={
                <Switch
                  value={isOn}
                  onValueChange={(next) => void handleToggle(next)}
                  disabled={isBusy || (!available && !isOn)}
                  trackColor={{ false: colors.border, true: palette.blueSky }}
                  thumbColor={isOn ? colors.primary : '#F4F3F4'}
                  accessibilityLabel="เปิดหรือปิดการล็อกแอป"
                />
              }
              isLast
            />
          </SecurityGroup>

          {message ? (
            <ThemedText type="body" weight="regular" themeColor="danger" accessibilityLiveRegion="polite" className="mt-4 px-2">
              {message}
            </ThemedText>
          ) : null}

          <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-6 px-2">
            ล็อกแอปทำงานบนเครื่องนี้เท่านั้น ไม่ได้ป้องกันการเข้าถึงบัญชีจากเครื่องอื่น
            สำหรับเรื่องนั้นให้ดูที่หน้าอุปกรณ์ที่เข้าสู่ระบบ
          </ThemedText>

          <View className="h-10" />
        </ScrollView>
      </View>
    </GradientBackground>
  );
}
