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

import { ThemedText } from '@/components/themed-text';
import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
import { GOOGLE_SIGN_IN_ENABLED, useGoogleSignIn, useLogin } from '@/modules/auth';
import { AlternateSignIn } from '@/modules/auth/components/alternate-sign-in';
import { AuthErrorBanner } from '@/modules/auth/components/auth-error-banner';
import { AuthShell } from '@/modules/auth/components/auth-shell';
import { AuthTabs } from '@/modules/auth/components/auth-tabs';
import { isGoogleSignInConfigured } from '@/modules/auth/hooks/use-google-sign-in';
import { formatCountdown, useRetryCountdown } from '@/modules/auth/hooks/use-retry-countdown';
import {
  readLastLoginMethod,
  type LastLoginMethod,
} from '@/modules/auth/lib/last-login-method';
import { validateLogin, type FieldErrors, type LoginField } from '@/modules/auth/lib/validation';
import { PASSKEY_ENABLED, isPasskeyAvailableOnDevice, usePasskeySignIn } from '@/modules/security';
import { useAuthStore } from '@/stores';
import { formatThaiPhone, stripPhoneDigits } from '@/utils/phone-format';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<LoginField>>({});
  const [lastUsed, setLastUsed] = useState<LastLoginMethod | null>(null);

  const { login, isPending, error, clearError } = useLogin();
  const passkey = usePasskeySignIn();
  const google = useGoogleSignIn();
  const throttle = useRetryCountdown();

  // Device-local, so it resolves without a request and never gates first paint.
  useEffect(() => {
    void readLastLoginMethod().then(setLastUsed);
  }, []);

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

  // Alternate methods surface their own failures in the same banner. The
  // throttle outranks them: it is the only one the user must wait out.
  const bannerMessage = throttle.isThrottled
    ? `ลองเข้าระบบบ่อยเกินไป กรุณารออีก ${formatCountdown(throttle.remaining ?? 0)}`
    : error && error.field === null
      ? error.message
      : (passkey.error?.message ?? google.error?.message ?? null);

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

      {/*
        * Below the submit button rather than beside the password field: this
        * is the exit from a failed sign-in, and putting it inline invites a
        * tap from people who have not tried their password yet.
        */}
      <View className="mt-4 items-center">
        <ThemedText
          testID="login-forgot-password"
          type="label"
          weight="regular"
          themeColor="secondary"
          onPress={() => router.push('/(auth)/forgot-password')}>
          ลืมรหัสผ่าน?
        </ThemedText>
      </View>

      <AlternateSignIn
        lastUsed={lastUsed}
        // Both are omitted rather than disabled when unavailable: a greyed-out
        // "sign in with Passkey" on a phone with no screen lock is a dead end
        // the user cannot resolve from this screen.
        // `PASSKEY_ENABLED` is off until the RP-ID / signing-key / domain /
        // package-name configuration lands; see `modules/security/lib/feature-flags.ts`.
        // Omitting the handler is enough — `AlternateSignIn` drops the row it
        // has no handler for, and drops itself when no method survives.
        onPasskey={
          PASSKEY_ENABLED && isPasskeyAvailableOnDevice()
            ? () => {
                void passkey.signInWithPasskey().then(
                  () => router.replace('/(tabs)'),
                  // Already turned into a banner by the hook.
                  () => {},
                );
              }
            : undefined
        }
        // `GOOGLE_SIGN_IN_ENABLED` is off by product decision, not a missing
        // configuration — see `modules/auth/lib/feature-flags.ts`. Both
        // conditions are checked because flipping the flag back on must not
        // by itself offer sign-in on a build with no client ID configured.
        onGoogle={
          GOOGLE_SIGN_IN_ENABLED && isGoogleSignInConfigured()
            ? () => {
                void google.signInWithGoogle().then(
                  () => router.replace('/(tabs)'),
                  () => {},
                );
              }
            : undefined
        }
        isPasskeyPending={passkey.isPending}
        isGooglePending={google.isPending}
      />
    </AuthShell>
  );
}
