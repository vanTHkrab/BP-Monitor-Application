/**
 * Change password. Ported from the form inside client-old's security screen,
 * with the validation moved out of `Alert` and onto the fields.
 *
 * An alert tells you something is wrong and then disappears, leaving you to
 * remember which of three identical-looking boxes it meant. Inline errors stay
 * next to the field — which matters more here than usual, because the people
 * most likely to mistype a password twice are the ones this app is for.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { formatAuthError, useChangePassword } from '@/modules/auth';
import { SecurityHeader } from '@/modules/security';

/** Matches the gateway's floor. Stated up front rather than after a failure. */
const MIN_PASSWORD_LENGTH = 8;

type Errors = {
  current?: string;
  next?: string;
  confirm?: string;
};

export default function ChangePasswordScreen() {
  const colors = useTheme();
  const { changePassword, isPending } = useChangePassword();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const validate = (): Errors => {
    const found: Errors = {};

    if (!current) found.current = 'กรุณากรอกรหัสผ่านปัจจุบัน';
    if (!next) found.next = 'กรุณากรอกรหัสผ่านใหม่';
    else if (next.length < MIN_PASSWORD_LENGTH)
      found.next = `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
    else if (next === current) found.next = 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม';

    if (!confirm) found.confirm = 'กรุณายืนยันรหัสผ่านใหม่';
    else if (next && confirm !== next) found.confirm = 'ยืนยันรหัสผ่านไม่ตรงกัน';

    return found;
  };

  const handleSubmit = async () => {
    const found = validate();
    setErrors(found);
    setBanner(null);
    if (Object.keys(found).length > 0) return;

    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setBanner({
        tone: 'ok',
        // Says what else happened. A password change that silently signed the
        // user's tablet out is a surprise they deserve to hear about here.
        text: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว อุปกรณ์เครื่องอื่นถูกออกจากระบบทั้งหมด',
      });
    } catch (cause) {
      const view = formatAuthError(cause, {
        context: 'login',
        fallback: 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่',
      });

      // The gateway answers a wrong current password with a 401. Putting it on
      // the field beats a banner the user has to map back to a box themselves.
      if (view.field === 'password') setErrors({ current: view.message });
      else setBanner({ tone: 'error', text: view.message });
    }
  };

  return (
    <GradientBackground>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SecurityHeader title="เปลี่ยนรหัสผ่าน" subject="self" />

        <ScrollView
          className="flex-1 px-4"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ThemedText type="body" weight="regular" themeColor="text-secondary" className="mb-5 mt-1">
            ตั้งรหัสผ่านใหม่อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร
            เมื่อเปลี่ยนแล้วอุปกรณ์เครื่องอื่นจะถูกออกจากระบบ
            แต่เครื่องนี้จะยังใช้งานต่อได้
          </ThemedText>

          {banner ? (
            <View
              className="mb-4 rounded-2xl p-4"
              style={{ backgroundColor: colors.surface }}
              accessibilityLiveRegion="polite"
            >
              <ThemedText type="body" weight="regular" style={{ color: banner.tone === 'ok' ? colors['text-primary'] : colors.danger }}>
                {banner.text}
              </ThemedText>
            </View>
          ) : null}

          <View className="rounded-2xl p-4" style={{ backgroundColor: colors.surface }}>
            <TextField
              testID="password-current"
              placeholder="รหัสผ่านปัจจุบัน"
              value={current}
              onChangeText={(text) => {
                setCurrent(text);
                if (errors.current) setErrors((prev) => ({ ...prev, current: undefined }));
              }}
              icon="lock-closed-outline"
              secureTextEntry
              autoComplete="password"
              error={errors.current}
            />
            <TextField
              testID="password-new"
              placeholder="รหัสผ่านใหม่"
              value={next}
              onChangeText={(text) => {
                setNext(text);
                if (errors.next) setErrors((prev) => ({ ...prev, next: undefined }));
              }}
              icon="key-outline"
              secureTextEntry
              autoComplete="new-password"
              error={errors.next}
            />
            <TextField
              testID="password-confirm"
              placeholder="ยืนยันรหัสผ่านใหม่"
              value={confirm}
              onChangeText={(text) => {
                setConfirm(text);
                if (errors.confirm) setErrors((prev) => ({ ...prev, confirm: undefined }));
              }}
              icon="shield-checkmark-outline"
              secureTextEntry
              autoComplete="new-password"
              error={errors.confirm}
            />
          </View>

          <View className="mt-5">
            <GradientButton
              testID="password-submit"
              title="บันทึกรหัสผ่านใหม่"
              onPress={() => void handleSubmit()}
              loading={isPending}
            />
          </View>

          <View className="h-10" />
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBackground>
  );
}
