/**
 * Devices signed into this account. Ported from the session list in
 * client-old's security screen.
 *
 * Two changes from the original. Revoked sessions are separated from active
 * ones instead of interleaved with a "สถานะ:" line — a mixed list makes the
 * user read every row to answer "is anything signed in that shouldn't be".
 * And the "log out everywhere" action moved below the list, because it is the
 * conclusion of reading it, not the first thing to offer.
 */
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { useTheme } from '@/hooks/use-theme';
import { useLoginSessions, useLogoutAllDevices } from '@/modules/auth';
import { SecurityGroup, SecurityHeader, SecurityRow } from '@/modules/security';

export default function DevicesScreen() {
  const { sessions, isLoading, refetch } = useLoginSessions();
  const { logoutAllDevices, isPending } = useLogoutAllDevices();
  const [error, setError] = useState<string | null>(null);

  const active = sessions.filter((session) => session.isActive);
  const revoked = sessions.filter((session) => !session.isActive);

  const confirmLogoutAll = () => {
    Alert.alert(
      'ออกจากระบบทุกอุปกรณ์',
      'อุปกรณ์เครื่องอื่นทั้งหมดจะต้องเข้าสู่ระบบใหม่ เครื่องนี้จะยังใช้งานต่อได้',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ออกจากระบบ',
          style: 'destructive',
          onPress: async () => {
            setError(null);
            try {
              await logoutAllDevices();
            } catch {
              setError('ออกจากระบบทุกอุปกรณ์ไม่สำเร็จ กรุณาลองใหม่');
            }
          },
        },
      ],
    );
  };

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="อุปกรณ์ที่เข้าสู่ระบบ" />

        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={() => void refetch()} />
          }
        >
          {active.length > 0 ? (
            <SecurityGroup title={`กำลังใช้งาน · ${active.length} เครื่อง`}>
              {active.map((session, index) => (
                <SecurityRow
                  key={session.id}
                  testID={`device-${session.id}`}
                  icon="phone-portrait-outline"
                  title={session.deviceLabel || 'อุปกรณ์ไม่ทราบชื่อ'}
                  value={`ใช้งานล่าสุด ${formatWhen(session.lastActiveAt)}`}
                  tone="good"
                  isLast={index === active.length - 1}
                />
              ))}
            </SecurityGroup>
          ) : (
            <EmptyState isLoading={isLoading} />
          )}

          {revoked.length > 0 ? (
            <SecurityGroup title="ออกจากระบบแล้ว">
              {revoked.slice(0, 5).map((session, index, shown) => (
                <SecurityRow
                  key={session.id}
                  icon="log-out-outline"
                  title={session.deviceLabel || 'อุปกรณ์ไม่ทราบชื่อ'}
                  value={
                    session.revokedAt
                      ? `ออกจากระบบเมื่อ ${formatWhen(session.revokedAt)}`
                      : 'ออกจากระบบแล้ว'
                  }
                  isLast={index === shown.length - 1}
                />
              ))}
            </SecurityGroup>
          ) : null}

          {error ? (
            <ThemedText type="body" weight="regular" themeColor="danger" accessibilityLiveRegion="polite" className="mt-4 px-2">
              {error}
            </ThemedText>
          ) : null}

          {active.length > 1 ? (
            <View className="mt-8">
              <GradientButton
                testID="devices-logout-all"
                title="ออกจากระบบทุกอุปกรณ์อื่น"
                variant="danger"
                onPress={confirmLogoutAll}
                loading={isPending}
              />
              <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-3 px-2 text-center">
                เครื่องนี้จะยังใช้งานต่อได้ตามปกติ
              </ThemedText>
            </View>
          ) : null}

          <View className="h-10" />
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

function EmptyState({ isLoading }: { isLoading: boolean }) {
  const colors = useTheme();

  return (
    <View className="mt-2 rounded-2xl p-5" style={{ backgroundColor: colors.surface }}>
      <ThemedText type="body" weight="regular" themeColor="text-secondary">
        {isLoading
          ? 'กำลังโหลดรายการอุปกรณ์…'
          : 'ยังไม่มีข้อมูลอุปกรณ์ ลองดึงหน้าจอลงเพื่อโหลดใหม่'}
      </ThemedText>
    </View>
  );
}

/** Today and yesterday get a time; anything older gets a date. */
function formatWhen(date: Date | string): string {
  const value = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const sameDay = value.toDateString() === now.toDateString();

  if (sameDay) {
    return `วันนี้ ${value.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
    })} น.`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (value.toDateString() === yesterday.toDateString()) {
    return `เมื่อวาน ${value.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
    })} น.`;
  }

  return value.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
