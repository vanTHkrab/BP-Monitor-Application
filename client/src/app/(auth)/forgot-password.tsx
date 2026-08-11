/**
 * Password reset by six-digit code.
 *
 * Two steps on one screen rather than two routes: the second step needs the
 * address typed into the first, and carrying it through a route param would
 * put an account identifier in the navigation state for the sake of a back
 * gesture nobody wants mid-reset.
 *
 * The copy after step one is conditional on purpose — "หากมีบัญชี..." rather
 * than "ส่งแล้ว". Better Auth answers `{ success: true }` for an address it
 * has never seen so the response cannot be used to enumerate users, which
 * means this screen genuinely does not know whether an email went out and
 * must not claim it did.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
import { useForgotPassword } from '@/modules/auth';
import { AuthErrorBanner } from '@/modules/auth/components/auth-error-banner';
import { AuthShell } from '@/modules/auth/components/auth-shell';
import { formatCountdown, useRetryCountdown } from '@/modules/auth/hooks/use-retry-countdown';
import {
  hasErrors,
  validateForgotPasswordEmail,
  validateResetPassword,
  type FieldErrors,
  type ForgotPasswordField,
  type ResetPasswordField,
} from '@/modules/auth/lib/validation';
import { useTheme } from '@/hooks/use-theme';

const RESEND_COOLDOWN_SEC = 60;

type Step = 'request' | 'reset' | 'done';

export default function ForgotPasswordScreen() {
  const colors = useTheme();
  const {
    requestOtp,
    isRequesting,
    requestError,
    resetPassword,
    isResetting,
    resetError,
  } = useForgotPassword();
  const cooldown = useRetryCountdown();

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailErrors, setEmailErrors] = useState<FieldErrors<ForgotPasswordField>>({});
  const [resetErrors, setResetErrors] = useState<FieldErrors<ResetPasswordField>>({});

  const handleRequest = async () => {
    if (isRequesting || cooldown.isThrottled) return;

    const errors = validateForgotPasswordEmail(email);
    setEmailErrors(errors);
    if (hasErrors(errors)) return;

    try {
      await requestOtp(email.trim());
      // Advance on success only. Landing on the code field after a failed
      // send would ask the user to type a code that was never issued.
      setStep('reset');
      cooldown.start(RESEND_COOLDOWN_SEC);
    } catch {
      // `requestError` already carries the formatted message.
    }
  };

  const handleSubmit = async () => {
    if (isResetting) return;

    const errors = validateResetPassword({ otp, password, confirmPassword });
    setResetErrors(errors);
    if (hasErrors(errors)) return;

    try {
      await resetPassword({ email: email.trim(), otp, password });
      setStep('done');
    } catch {
      // handled by resetError
    }
  };

  if (step === 'done') {
    return (
      <AuthShell showHero={false}>
        <ThemedText size={18} weight="semibold" className="mb-2 text-center">
          ตั้งรหัสผ่านใหม่สำเร็จ
        </ThemedText>
        <ThemedText
          type="label"
          weight="regular"
          themeColor="text-secondary"
          className="mb-4 text-center">
          อุปกรณ์ที่เคยเข้าสู่ระบบไว้ทั้งหมดถูกออกจากระบบแล้ว กรุณาเข้าสู่ระบบใหม่ด้วยรหัสผ่านใหม่
        </ThemedText>
        <GradientButton
          testID="forgot-password-done"
          title="ไปหน้าเข้าสู่ระบบ"
          onPress={() => router.replace('/(auth)/login')}
          size="large"
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell showHero={false}>
      <ThemedText size={18} weight="semibold" className="mb-1 text-center">
        ลืมรหัสผ่าน
      </ThemedText>
      <ThemedText
        type="label"
        weight="regular"
        themeColor="text-secondary"
        className="mb-4 text-center">
        {step === 'request'
          ? 'กรอกอีเมลที่ใช้สมัคร เราจะส่งรหัส 6 หลักไปให้'
          : `หากมีบัญชีที่ใช้ ${email.trim()} เราได้ส่งรหัส 6 หลักไปแล้ว`}
      </ThemedText>

      {requestError ? <AuthErrorBanner message={requestError.message} /> : null}
      {resetError ? <AuthErrorBanner message={resetError.message} /> : null}

      {step === 'request' ? (
        <>
          <TextField
            testID="forgot-password-email"
            placeholder="อีเมล"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setEmailErrors({});
            }}
            icon="mail-outline"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={emailErrors.email}
          />

          <View className="mt-2">
            <GradientButton
              testID="forgot-password-request"
              title="ส่งรหัสยืนยัน"
              onPress={handleRequest}
              loading={isRequesting}
              size="large"
            />
          </View>
        </>
      ) : (
        <>
          <TextField
            testID="forgot-password-otp"
            placeholder="รหัสยืนยัน 6 หลัก"
            value={otp}
            onChangeText={(text) => setOtp(text.replace(/[^0-9]/g, '').slice(0, 6))}
            icon="key-outline"
            keyboardType="number-pad"
            error={resetErrors.otp}
          />

          <TextField
            testID="forgot-password-new"
            placeholder="รหัสผ่านใหม่"
            value={password}
            onChangeText={setPassword}
            icon="lock-closed-outline"
            secureTextEntry
            autoComplete="new-password"
            error={resetErrors.password}
          />

          <TextField
            testID="forgot-password-confirm"
            placeholder="ยืนยันรหัสผ่านใหม่"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            icon="lock-closed-outline"
            secureTextEntry
            autoComplete="new-password"
            error={resetErrors.confirmPassword}
          />

          <View className="mt-2">
            <GradientButton
              testID="forgot-password-submit"
              title="ตั้งรหัสผ่านใหม่"
              onPress={handleSubmit}
              loading={isResetting}
              size="large"
            />
          </View>

          <View className="mt-4 items-center">
            <ThemedText
              testID="forgot-password-resend"
              type="label"
              weight="regular"
              onPress={handleRequest}
              style={{
                color: cooldown.isThrottled ? colors['text-secondary'] : colors.secondary,
              }}>
              {cooldown.isThrottled
                ? `ส่งรหัสใหม่ได้ในอีก ${formatCountdown(cooldown.remaining ?? 0)}`
                : 'ส่งรหัสอีกครั้ง'}
            </ThemedText>
          </View>
        </>
      )}

      <View className="mt-4 items-center">
        <ThemedText
          testID="forgot-password-back"
          type="label"
          weight="regular"
          onPress={() => router.replace('/(auth)/login')}
          style={{ color: colors['text-secondary'] }}>
          กลับไปหน้าเข้าสู่ระบบ
        </ThemedText>
      </View>
    </AuthShell>
  );
}
