/**
 * Password reset by six-digit code, mirroring `use-verify-email.ts`'s split
 * into two mutations with **separate** error slots — the screen has two
 * buttons ("send again" and "set new password") and collapsing the slots
 * means asking for a fresh code wipes the "รหัสยืนยันไม่ถูกต้อง" the user is
 * still reading.
 *
 * A code, not a link. The project already made that call for email
 * verification (see `better-auth.ts`'s `emailOTP` comment) and the reasoning
 * is stronger here: a reset link would open the system browser on a
 * gateway that serves no HTML, so there is nowhere for it to land.
 *
 * Deliberately no cache write and no store touch. A reset ends every session
 * server-side (`revokeSessionsOnPasswordReset`), and this flow is reached
 * from the login screen by someone who is signed out already — there is no
 * `me` to patch, and writing one would fabricate a session the transport
 * cannot back.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import * as emailOtpApi from '../services/email-otp-api';
import { formatAuthError } from '../lib/errors';
import type { AuthErrorView } from '../types';

export function useForgotPassword() {
  const [requestError, setRequestError] = useState<AuthErrorView | null>(null);
  const [resetError, setResetError] = useState<AuthErrorView | null>(null);

  const request = useMutation({
    mutationFn: (email: string) => emailOtpApi.requestPasswordResetOtp(email),
    onMutate: () => setRequestError(null),
    onError: (cause) =>
      setRequestError(
        formatAuthError(cause, { fallback: 'ส่งรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่' }),
      ),
  });

  const reset = useMutation({
    mutationFn: (input: { email: string; otp: string; password: string }) =>
      emailOtpApi.resetPasswordWithOtp(input),
    onMutate: () => setResetError(null),
    onError: (cause) =>
      setResetError(
        formatAuthError(cause, { fallback: 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่' }),
      ),
  });

  return {
    requestOtp: request.mutateAsync,
    isRequesting: request.isPending,
    requestError,
    resetPassword: reset.mutateAsync,
    isResetting: reset.isPending,
    resetError,
  };
}
