/**
 * Login as a mutation.
 *
 * Orchestration lives here rather than in the service: the service calls the
 * gateway, this decides what that means for the app (write the token, mark
 * the session, drop stale cached data).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { setAuthToken } from "@/services/auth-token";
import { useAuthStore } from "@/stores";
import { formatAuthError } from "../lib/errors";
import * as authApi from "../services/auth-api";
import type { AuthErrorView, LoginInput } from "../types";

export function useLogin() {
  const signedIn = useAuthStore((state) => state.signedIn);
  const queryClient = useQueryClient();
  const [error, setError] = useState<AuthErrorView | null>(null);

  const mutation = useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    onMutate: () => setError(null),
    onSuccess: async ({ token, user }) => {
      // Token first: `signedIn` below releases the route gate, and a
      // request that beats the token write would go out unauthenticated.
      await setAuthToken(token);

      // The previous user's cached queries must not survive into this
      // session. This has to run *before* `signedIn`, not after: Zustand
      // notifies subscribers synchronously, so a component reading the
      // store can re-render the instant `signedIn` flips `status` — and if
      // the `me` cache still held the previous user's `roleSelectedAt` at
      // that moment, the onboarding gate would read *their* answer for
      // *this* account. Repopulating the cache first closes that window:
      // by the time the gate can observe `status === 'authenticated'`, `me`
      // already reflects the account that just signed in.
      queryClient.clear();
      queryClient.setQueryData(["me"], user);

      signedIn({ userId: user.id, token });
    },
    onError: (cause) =>
      setError(
        formatAuthError(cause, {
          context: "login",
          fallback: "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง",
        }),
      ),
  });

  return {
    login: mutation.mutateAsync,
    isPending: mutation.isPending,
    error,
    clearError: () => setError(null),
  };
}
