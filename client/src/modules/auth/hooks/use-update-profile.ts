/**
 * The general profile write.
 *
 * Lives in `auth` rather than in `modules/profile`, even though the profile
 * screen is its only real caller, because the `me` query lives here
 * (`use-session.ts`) and whoever mutates a query has to be the one that
 * refreshes it. A hook in another module writing `me` from the outside is how
 * a screen ends up rendering a name the server no longer has.
 *
 * `setQueryData` rather than `invalidateQueries`: the mutation already
 * returns the updated `UserType`, so refetching it would be a second round
 * trip for an answer we are holding. Same choice as `use-set-phone.ts`.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as authApi from '../services/auth-api';
import type { User } from '../types';

export type UpdateProfileInput = Parameters<typeof authApi.updateProfile>[0];

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdateProfileInput) => authApi.updateProfile(input),
    onSuccess: (user: User) => {
      queryClient.setQueryData(['me'], user);
    },
  });

  return {
    updateProfile: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}
