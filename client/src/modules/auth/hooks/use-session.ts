/**
 * Read-only view of the session for screens.
 *
 * `user` deliberately comes from the `me` query, not the store: the store
 * holds identity for routing, the query holds the profile. One copy of the
 * profile means a successful `updateProfile` cannot leave a stale name
 * rendered somewhere else.
 */
import { useQuery } from "@tanstack/react-query";

import { useAuthStore } from "@/stores";
import * as authApi from "../services/auth-api";

export function useSession() {
  const status = useAuthStore((state) => state.status);
  const userId = useAuthStore((state) => state.userId);
  const isAuthenticated = status === "authenticated";

  const query = useQuery({
    queryKey: ["me"],
    queryFn: authApi.fetchMe,
    // Nothing to fetch without a session, and firing it anyway produces a
    // 401 that would trip the global sign-out fan-out.
    enabled: isAuthenticated,
  });

  return {
    status,
    userId,
    isAuthenticated,
    user: query.data ?? null,
    isLoadingUser: query.isLoading,
  };
}
