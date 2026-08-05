/**
 * Passkey management.
 *
 * New in this pass — client-old had no equivalent. The screen's job is mostly
 * explanation: "passkey" is a word almost none of this app's users have met,
 * and a list with an Add button teaches nobody. So the empty state carries the
 * pitch in plain Thai, and the rows say the one thing that actually differs
 * between credentials — whether losing this phone loses the passkey.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { useTheme } from '@/hooks/use-theme';
import { formatAuthError } from '@/modules/auth';
import {
  isPasskeyAvailableOnDevice,
  useDeletePasskey,
  usePasskeys,
  useRegisterPasskey,
  useSecurityOverview,
  SecurityGroup,
  SecurityHeader,
  SecurityRow,
} from '@/modules/security';
import type { Passkey } from '@/modules/security';

export default function PasskeysScreen() {
  const colors = useTheme();
  const { overview } = useSecurityOverview();
  const { passkeys, isLoading, refetch } = usePasskeys();
  const { registerPasskey, isPending: isRegistering } = useRegisterPasskey();
  const { deletePasskey } = useDeletePasskey();
  const [error, setError] = useState<string | null>(null);

  const deviceSupported = isPasskeyAvailableOnDevice();
  const serverSupported = overview?.passkeySupported ?? false;

  const handleAdd = async () => {
    setError(null);
    try {
      // No name: the API falls back to the platform label ("Android App"),
      // which is more useful than an empty row and can be renamed later.
      await registerPasskey(undefined);
    } catch (cause) {
      // A cancelled system sheet is the user answering "no", not a failure to
      // report back at them.
      const message = cause instanceof Error ? cause.message : String(cause ?? '');
      if (/cancel|abort|user.?dismiss/i.test(message)) return;

      setError(
        formatAuthError(cause, {
          context: 'login',
          fallback: 'เพิ่ม Passkey ไม่สำเร็จ กรุณาลองใหม่',
        }).message,
      );
    }
  };

  const handleDelete = (passkey: Passkey) => {
    Alert.alert(
      'ลบ Passkey นี้?',
      `${passkey.name ?? 'Passkey'} จะใช้เข้าสู่ระบบไม่ได้อีก และต้องเพิ่มใหม่ถ้าต้องการใช้อีกครั้ง`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePasskey(passkey.id);
            } catch (cause) {
              // The gateway refuses to delete the last way into an account.
              // That message is the whole point of the refusal, so it is shown
              // as-is rather than flattened into "ลบไม่สำเร็จ".
              setError(
                formatAuthError(cause, {
                  context: 'login',
                  fallback: 'ลบ Passkey ไม่สำเร็จ',
                }).message,
              );
            }
          },
        },
      ],
    );
  };

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="Passkey" subject="self" />

        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={() => void refetch()} />
          }
        >
          <Explainer />

          {error ? (
            <View
              className="mb-4 rounded-2xl p-4"
              style={{ backgroundColor: colors.surface }}
              accessibilityLiveRegion="polite"
            >
              <ThemedText type="body" weight="regular" themeColor="danger">
                {error}
              </ThemedText>
            </View>
          ) : null}

          {passkeys.length > 0 ? (
            <SecurityGroup title="ที่เพิ่มไว้แล้ว">
              {passkeys.map((passkey, index) => (
                <SecurityRow
                  key={passkey.id}
                  testID={`passkey-${passkey.id}`}
                  icon="finger-print-outline"
                  title={passkey.name ?? 'Passkey'}
                  value={formatAddedAt(passkey.createdAt)}
                  hint={
                    passkey.backedUp
                      ? 'สำรองไว้กับบัญชีแล้ว ใช้ได้จากเครื่องอื่นของคุณ'
                      : 'อยู่บนเครื่องนี้เท่านั้น ถ้าเครื่องหายจะใช้ไม่ได้'
                  }
                  tone={passkey.backedUp ? 'good' : 'attention'}
                  onPress={() => handleDelete(passkey)}
                  accessory={
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  }
                  isLast={index === passkeys.length - 1}
                />
              ))}
            </SecurityGroup>
          ) : null}

          <View className="mt-6">
            <GradientButton
              testID="passkey-add"
              title="เพิ่ม Passkey บนเครื่องนี้"
              onPress={() => void handleAdd()}
              loading={isRegistering}
              disabled={!deviceSupported || !serverSupported}
              icon={<Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />}
            />
          </View>

          {/* Says which side is missing. "ไม่รองรับ" alone leaves the user
              trying to fix a phone that is fine. */}
          {!deviceSupported || !serverSupported ? (
            <ThemedText type="small" weight="regular" themeColor="text-secondary" className="mt-3 px-2 text-center">
              {!deviceSupported
                ? 'เครื่องนี้ยังใช้ Passkey ไม่ได้ ลองตั้งค่าการปลดล็อกหน้าจอ (PIN, ลายนิ้วมือ หรือใบหน้า) ในการตั้งค่าของเครื่องก่อน'
                : 'ระบบยังไม่เปิดใช้งาน Passkey สำหรับเซิร์ฟเวอร์นี้'}
            </ThemedText>
          ) : null}

          <View className="h-10" />
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

function Explainer() {
  const colors = useTheme();

  return (
    <View className="mt-2 rounded-2xl p-5" style={{ backgroundColor: colors.surface }}>
      <ThemedText type="bodyLarge" weight="bold">
        เข้าสู่ระบบด้วยลายนิ้วมือหรือใบหน้า
      </ThemedText>
      <ThemedText type="body" weight="regular" themeColor="text-secondary" className="mt-2">
        Passkey ใช้การปลดล็อกของเครื่องแทนรหัสผ่าน ไม่ต้องจำ ไม่ต้องพิมพ์
        และเอาไปใช้บนเครื่องอื่นไม่ได้ถึงจะรู้รหัสผ่านของคุณ
      </ThemedText>
    </View>
  );
}

/**
 * Day precision. A passkey registered at 14:32 is not information anyone acts
 * on; "เพิ่มเมื่อ 1 ส.ค. 2569" is enough to recognise which device it was.
 */
function formatAddedAt(date: Date): string {
  return `เพิ่มเมื่อ ${date.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}
