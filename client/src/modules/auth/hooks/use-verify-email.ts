/**
 * Email OTP verification as two mutations, mirroring `use-login.ts`'s split
 * between "call the service" and "decide what it means for the app".
 *
 * Verification is never required to use the app — it gates one thing, Google
 * account linking — so there is deliberately no route-gate signal here, only
 * a cache write so `useSession().user.emailVerified` reflects it immediately.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import * as emailOtpApi from '../services/email-otp-api';
import { formatAuthError } from '../lib/errors';
import type { AuthErrorView, User } from '../types';

export function useVerifyEmail() {
  const queryClient = useQueryClient();
  const [sendError, setSendError] = useState<AuthErrorView | null>(null);
  const [verifyError, setVerifyError] = useState<AuthErrorView | null>(null);

  const send = useMutation({
    mutationFn: (email: string) => emailOtpApi.sendVerificationOtp(email),
    onMutate: () => setSendError(null),
    onError: (cause) =>
      setSendError(
        formatAuthError(cause, { fallback: 'ส่งรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่' }),
      ),
  });

  const verify = useMutation({
    mutationFn: (input: { email: string; otp: string }) =>
      emailOtpApi.verifyEmailOtp(input.email, input.otp),
    onMutate: () => setVerifyError(null),
    onSuccess: () => {
      queryClient.setQueryData<User>(['me'], (current) =>
        current ? { ...current, emailVerified: true } : current,
      );
    },
    onError: (cause) =>
      setVerifyError(
        formatAuthError(cause, { fallback: 'ยืนยันอีเมลไม่สำเร็จ กรุณาลองใหม่' }),
      ),
  });

  return {
    sendOtp: send.mutateAsync,
    isSending: send.isPending,
    sendError,
    verifyOtp: verify.mutateAsync,
    isVerifying: verify.isPending,
    verifyError,
  };
}
