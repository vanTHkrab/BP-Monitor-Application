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

/*
 * Deep import, not `@/modules/notifications`. That barrel pulls in
 * `hooks/use-reminder-settings.ts`, which imports `@/modules/auth` — going
 * through it from inside the auth module would close a cycle. This file is a
 * leaf: it reaches AsyncStorage and `@/services/api`, and nothing else.
 */
import {
  forgetPushToken,
  getRegisteredPushToken,
} from "@/modules/notifications/services/push-registration";

export function useLogout() {
  const signedOut = useAuthStore((state) => state.signedOut);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      // Read before the revoke, because the revoke is what consumes it: the
      // gateway cannot work out which installation is leaving from the session
      // alone — a `PushToken` row is not session-scoped — so without this the
      // signed-out phone keeps receiving a patient's critical alerts.
      const pushToken = (await getRegisteredPushToken()) ?? undefined;

      try {
        await authApi.logout(pushToken);
      } catch {
        // Best effort. The local clear below is what the user asked for.
      }
      await clearAuthToken();
      // Forgotten either way. If the revoke failed the row survives on the
      // server, but keeping the token here would hand it to the *next*
      // account on this handset as theirs to unregister.
      await forgetPushToken();
    },
    onSettled: () => {
      signedOut();
      queryClient.clear();
    },
  });

  return { logout: mutation.mutateAsync, isPending: mutation.isPending };
}
