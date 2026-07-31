/**
 * Sign-out. Always clears locally, even when the server revoke fails.
 *
 * The user pressed "log out" and that has to be honoured — an offline device
 * that stayed signed in because a network call failed is the worse outcome,
 * especially on a shared or borrowed phone.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { clearAuthToken } from "@/services/auth-token";
import { useAuthStore } from "@/stores";
import * as authApi from "../services/auth-api";

export function useLogout() {
  const signedOut = useAuthStore((state) => state.signedOut);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      try {
        await authApi.logout();
      } catch {
        // Best effort. The local clear below is what the user asked for.
      }
      await clearAuthToken();
    },
    onSettled: () => {
      signedOut();
      queryClient.clear();
    },
  });

  return { logout: mutation.mutateAsync, isPending: mutation.isPending };
}
