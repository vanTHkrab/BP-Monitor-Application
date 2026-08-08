/**
 * Mandatory phone collection after a Google sign-up.
 *
 * A Google account carries no phone number, and `phone` is `NOT NULL` and
 * unique — caregivers find patients by it — so this has to run before the
 * account is usable, ahead of `/onboarding/role`.
 *
 * Not yet reachable: Google OAuth has no credentials configured
 * (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), so there is no OAuth callback
 * to route here from. The screen and its mutation are ready — wiring the
 * navigation is a one-line addition to the callback handler once OAuth
 * lands.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import {  } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
import { useSetPhone } from '@/modules/auth';
import { AuthErrorBanner } from '@/modules/auth/components/auth-error-banner';
import { AuthShell } from '@/modules/auth/components/auth-shell';
import { isValidPhone } from '@/modules/auth/lib/validation';
import { formatThaiPhone, stripPhoneDigits } from '@/utils/phone-format';

export default function OnboardingPhoneScreen() {
  const { setPhone, isPending, error, clearError } = useSetPhone();
  const [phone, setPhoneValue] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();

  const handleSubmit = async () => {
    if (isPending) return;

    const digits = stripPhoneDigits(phone);
    if (!digits) {
      setFieldError('กรุณากรอกเบอร์โทรศัพท์');
      return;
    }
    if (!isValidPhone(digits)) {
      setFieldError('เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก');
      return;
    }

    try {
      await setPhone(digits);
      router.replace('/onboarding/role');
    } catch {
      // `error` already carries the formatted message; rendered below.
    }
  };

  return (
    <AuthShell showHero={false}>
      <ThemedText type="heading" className="mb-1 text-center">
        เพิ่มเบอร์โทรศัพท์
      </ThemedText>
      <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mb-4 text-center">
        ใช้สำหรับให้ผู้ดูแลค้นหาบัญชีของคุณ
      </ThemedText>

      {error ? <AuthErrorBanner message={error.message} /> : null}

      <TextField
        testID="onboarding-phone-input"
        placeholder="เบอร์โทรศัพท์"
        value={phone}
        onChangeText={(text) => {
          setPhoneValue(formatThaiPhone(text));
          setFieldError(undefined);
          clearError();
        }}
        icon="call-outline"
        keyboardType="phone-pad"
        autoComplete="tel"
        error={fieldError}
      />

      <GradientButton
        testID="onboarding-phone-submit"
        title="ดำเนินการต่อ"
        onPress={handleSubmit}
        loading={isPending}
        size="large"
      />
    </AuthShell>
  );
}
