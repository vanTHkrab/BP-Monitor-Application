/**
 * Sign in with phone + password.
 *
 * Ported from client-old/app/(auth)/login.tsx. The screen no longer reads
 * error state out of a global store — `useLogin` returns an already-formatted
 * `AuthErrorView`, and this file only decides where each one renders.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
import { useLogin } from '@/modules/auth';
import { AuthErrorBanner } from '@/modules/auth/components/auth-error-banner';
import { AuthShell } from '@/modules/auth/components/auth-shell';
import { AuthTabs } from '@/modules/auth/components/auth-tabs';
import { formatCountdown, useRetryCountdown } from '@/modules/auth/hooks/use-retry-countdown';
import { validateLogin, type FieldErrors, type LoginField } from '@/modules/auth/lib/validation';
import { useAuthStore } from '@/stores';
import { formatThaiPhone, stripPhoneDigits } from '@/utils/phone-format';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<LoginField>>({});

  const { login, isPending, error, clearError } = useLogin();
  const throttle = useRetryCountdown();

  // Set by the 401 fan-out when a session is revoked mid-use. Shown once and
  // cleared on leaving, so it does not reappear after an ordinary sign-out.
  const endedReason = useAuthStore((state) => state.endedReason);
  const clearEndedReason = useAuthStore((state) => state.clearEndedReason);

  useEffect(() => () => clearEndedReason(), [clearEndedReason]);

  const retryAfterSec = error?.retryAfterSec ?? null;
  const startThrottle = throttle.start;

  useEffect(() => {
    if (retryAfterSec) startThrottle(retryAfterSec);
  }, [retryAfterSec, startThrottle]);

  const resetErrors = () => {
    setFieldErrors({});
    clearError();
  };

  const handleSubmit = async () => {
    if (throttle.isThrottled || isPending) return;

    const errors = validateLogin({ phone, password });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      await login({ phone: stripPhoneDigits(phone), password });
      router.replace('/(tabs)');
    } catch {
      // `useLogin` already turned this into a displayable view — rendering is
      // handled below. Rethrowing would surface as an unhandled rejection.
    }
  };

  // A server error that names a field renders under it; the rest go to the
  // banner. `both` reddens the phone input without repeating the message.
  const serverFieldError = (field: LoginField): string | undefined => {
    if (!error) return undefined;
    if (error.field === field) return error.message;
    if (error.field === 'both') return field === 'phone' ? '' : error.message;
    return undefined;
  };

  const bannerMessage = throttle.isThrottled
    ? `ลองเข้าระบบบ่อยเกินไป กรุณารออีก ${formatCountdown(throttle.remaining ?? 0)}`
    : error && error.field === null
      ? error.message
      : null;

  const submitTitle = throttle.isThrottled
    ? `รอ ${formatCountdown(throttle.remaining ?? 0)}`
    : 'เข้าสู่ระบบ';

  return (
    <AuthShell>
      <AuthTabs active="login" />

      {endedReason === 'session-expired' && !error ? (
        <AuthErrorBanner tone="info" message="เซสชันของคุณหมดอายุ กรุณาเข้าสู่ระบบใหม่" />
      ) : null}

      {bannerMessage ? <AuthErrorBanner message={bannerMessage} /> : null}

      <TextField
        testID="login-phone"
        placeholder="เบอร์โทรศัพท์"
        value={phone}
        onChangeText={(text) => {
          setPhone(formatThaiPhone(text));
          resetErrors();
        }}
        icon="person-outline"
        keyboardType="phone-pad"
        autoComplete="tel"
        error={fieldErrors.phone ?? serverFieldError('phone')}
      />

      <TextField
        testID="login-password"
        placeholder="รหัสผ่าน"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          resetErrors();
        }}
        icon="lock-closed-outline"
        secureTextEntry
        autoComplete="password"
        error={fieldErrors.password ?? serverFieldError('password')}
      />

      <View className="mt-2">
        <GradientButton
          testID="login-submit"
          title={submitTitle}
          onPress={handleSubmit}
          loading={isPending}
          disabled={throttle.isThrottled}
          size="large"
        />
      </View>
    </AuthShell>
  );
}
