/**
 * I/O for the onboarding steps. Calls and maps; owns no state.
 */
import { graphqlRequest } from '@/services/api';
import { userFromGql, type UserPayload } from '@/modules/auth/lib/mappers';
import type { User } from '@/modules/auth/types';
import type { SelectableRole } from '../types';
import { GQL_SELECT_ROLE } from './operations';

export async function selectRole(role: SelectableRole): Promise<User> {
  const data = await graphqlRequest<{ selectRole: UserPayload }>(GQL_SELECT_ROLE, {
    input: { role },
  });
  return userFromGql(data.selectRole);
}
