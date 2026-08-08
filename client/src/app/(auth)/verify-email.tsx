/**
 * Six-digit email verification.
 *
 * A code typed into the app, not a link — a link would leave for the system
 * browser and have to deep-link back. Reachable from the Google sign-in
 * refusal banner ("resend") and, later, a settings row; never part of the
 * onboarding route gate, because verification is never required to use the
 * app — it only gates linking a Google account.
 */
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
import { useSession, useVerifyEmail } from '@/modules/auth';
import { AuthErrorBanner } from '@/modules/auth/components/auth-error-banner';
import { AuthShell } from '@/modules/auth/components/auth-shell';
import { formatCountdown, useRetryCountdown } from '@/modules/auth/hooks/use-retry-countdown';
import { useTheme } from '@/hooks/use-theme';

const RESEND_COOLDOWN_SEC = 60;

export default function VerifyEmailScreen() {
  const colors = useTheme();
  const { user } = useSession();
  const { sendOtp, isSending, sendError, verifyOtp, isVerifying, verifyError } = useVerifyEmail();
  const cooldown = useRetryCountdown();

  const [otp, setOtp] = useState('');
  const [verified, setVerified] = useState(false);

  /**
   * "Have we already auto-sent?" — a ref, not state, because nothing renders
   * it. As state it also had to be set synchronously inside the effect below,
   * which re-rendered the screen for a value no one reads
   * (`react-hooks/set-state-in-effect`).
   */
  const hasAutoSent = useRef(false);

  const email = user?.email ?? null;

  // Fire the first code automatically — the user came here specifically to
  // verify, so making them tap "send" first is one extra step with no
  // benefit.
  useEffect(() => {
    if (!email || hasAutoSent.current) return;
    hasAutoSent.current = true;
    sendOtp(email)
      .then(() => cooldown.start(RESEND_COOLDOWN_SEC))
      .catch(() => {
        // sendError already carries the formatted message; nothing else to do.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const handleResend = async () => {
    if (!email || cooldown.isThrottled || isSending) return;
    try {
      await sendOtp(email);
      cooldown.start(RESEND_COOLDOWN_SEC);
    } catch {
      // handled by sendError
    }
  };

  const handleVerify = async () => {
    if (!email || otp.length !== 6 || isVerifying) return;
    try {
      await verifyOtp({ email, otp });
      setVerified(true);
    } catch {
      // handled by verifyError
    }
  };

  if (!email) {
    return (
      <AuthShell showHero={false}>
        <AuthErrorBanner
          tone="info"
          message="บัญชีนี้ยังไม่มีอีเมล กรุณาเพิ่มอีเมลในโปรไฟล์ก่อนยืนยันตัวตน"
        />
      </AuthShell>
    );
  }

  if (verified) {
    return (
      <AuthShell showHero={false}>
        <ThemedText type="heading" className="mb-4 text-center">
          ยืนยันอีเมลสำเร็จ
        </ThemedText>
        <GradientButton
          testID="verify-email-done"
          title="กลับ"
          onPress={() => router.back()}
          size="large"
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell showHero={false}>
      <ThemedText type="heading" className="mb-1 text-center">
        ยืนยันอีเมล
      </ThemedText>
      <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mb-4 text-center">
        กรอกรหัส 6 หลักที่ส่งไปยัง {email}
      </ThemedText>

      {sendError ? <AuthErrorBanner message={sendError.message} /> : null}
      {verifyError ? <AuthErrorBanner message={verifyError.message} /> : null}

      <TextField
        testID="verify-email-otp"
        placeholder="รหัสยืนยัน 6 หลัก"
        value={otp}
        onChangeText={(text) => setOtp(text.replace(/[^0-9]/g, '').slice(0, 6))}
        icon="key-outline"
        keyboardType="number-pad"
      />

      <View className="mt-2">
        <GradientButton
          testID="verify-email-submit"
          title="ยืนยัน"
          onPress={handleVerify}
          loading={isVerifying}
          disabled={otp.length !== 6}
          size="large"
        />
      </View>

      <View className="mt-4 items-center">
        <ThemedText type="label" weight="regular" onPress={handleResend} style={{ color: cooldown.isThrottled ? colors['text-secondary'] : colors.secondary }}>
          {cooldown.isThrottled
            ? `ส่งรหัสใหม่ได้ในอีก ${formatCountdown(cooldown.remaining ?? 0)}`
            : 'ส่งรหัสอีกครั้ง'}
        </ThemedText>
      </View>
    </AuthShell>
  );
}
