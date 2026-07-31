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
      // Token first: the store flipping to `authenticated` releases the
      // route gate, and a request that beats the write would go out
      // unauthenticated.
      await setAuthToken(token);
      signedIn({ userId: user.id, token });
      // The previous user's cached queries must not survive into this
      // session. Nothing is fetched yet at this point, so clearing is
      // cheaper and safer than invalidating key by key.
      queryClient.clear();
      queryClient.setQueryData(["me"], user);
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
