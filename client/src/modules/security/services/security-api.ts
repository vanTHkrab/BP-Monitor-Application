/**
 * The gateway side of the security screen. I/O only — it calls, maps, and
 * returns; it does not touch the store and it does not format errors.
 *
 * The passkey ceremonies live here in full rather than being split between
 * this file and a hook, because each one is a three-step sequence
 * (options → authenticator → verify) where the middle step is a native call
 * and the `challengeToken` has to survive across all three. Splitting it puts
 * half a protocol in a React hook.
 */
import { Passkey as NativePasskey } from 'react-native-passkey';

import { graphqlRequest } from '@/services/api';
import { userFromGql, type UserPayload } from '@/modules/auth/lib/mappers';
import type { User } from '@/modules/auth/types';
import {
  GQL_DELETE_PASSKEY,
  GQL_PASSKEY_AUTH_OPTIONS,
  GQL_PASSKEY_AUTH_VERIFY,
  GQL_PASSKEY_REGISTER_OPTIONS,
  GQL_PASSKEY_REGISTER_VERIFY,
  GQL_PASSKEYS,
  GQL_RENAME_PASSKEY,
  GQL_SECURITY_OVERVIEW,
} from './operations';
import type { LoginMethod, Passkey, SecurityOverview } from '../types';

type PasskeyPayload = {
  id: string;
  name: string | null;
  backedUp: boolean;
  deviceType: string | null;
  createdAt: string;
};

type ChallengePayload = { optionsJson: string; challengeToken: string };

function passkeyFromGql(payload: PasskeyPayload): Passkey {
  return {
    id: payload.id,
    name: payload.name ?? undefined,
    backedUp: payload.backedUp,
    deviceType: payload.deviceType ?? undefined,
    createdAt: new Date(payload.createdAt),
  };
}

/**
 * Same rationale as `auth-api.ts`'s: `EXPO_OS` rather than a real device name,
 * which needs a permission on Android and adds nothing here.
 */
function deviceLabel(): string {
  switch (process.env.EXPO_OS) {
    case 'ios':
      return 'iPhone App';
    case 'android':
      return 'Android App';
    default:
      return 'Web App';
  }
}

export async function fetchSecurityOverview(): Promise<SecurityOverview> {
  const data = await graphqlRequest<{
    securityOverview: Omit<SecurityOverview, 'lastLoginMethod'> & {
      lastLoginMethod: string | null;
    };
  }>(GQL_SECURITY_OVERVIEW);

  const { lastLoginMethod, ...rest } = data.securityOverview;
  return {
    ...rest,
    // Narrowed rather than cast: the column is a plain string server-side, so
    // an unrecognised value means the gateway grew a login method this build
    // does not know about. Dropping it shows "unknown" instead of rendering a
    // raw identifier at the user.
    lastLoginMethod: isLoginMethod(lastLoginMethod) ? lastLoginMethod : undefined,
  };
}

const LOGIN_METHODS: LoginMethod[] = ['email', 'phone-number', 'google', 'passkey'];

function isLoginMethod(value: string | null): value is LoginMethod {
  return value !== null && (LOGIN_METHODS as string[]).includes(value);
}

export async function fetchPasskeys(): Promise<Passkey[]> {
  const data = await graphqlRequest<{ passkeys: PasskeyPayload[] }>(GQL_PASSKEYS);
  return data.passkeys.map(passkeyFromGql);
}

/**
 * True when this device can do passkeys at all.
 *
 * Checked before the button is offered rather than after it is pressed: on a
 * device with no screen lock configured the native call fails with a message
 * the user cannot act on, whereas a disabled row with an explanation can tell
 * them to set up a screen lock first.
 */
export function isPasskeySupportedOnDevice(): boolean {
  return NativePasskey.isSupported();
}

/**
 * Registers a new passkey for the signed-in user.
 *
 * The `challengeToken` round-trip is the interesting part: Better Auth joins
 * its two calls with a signed cookie, and this client authenticates with a
 * bearer token and has no cookie jar, so the gateway hands the cookie back as
 * an ordinary field and takes it again here. It is opaque to us by design.
 */
export async function registerPasskey(name?: string): Promise<Passkey> {
  const options = await graphqlRequest<{
    passkeyRegisterOptions: ChallengePayload;
  }>(GQL_PASSKEY_REGISTER_OPTIONS);

  const { optionsJson, challengeToken } = options.passkeyRegisterOptions;

  // The native module takes the spec's JSON as a string and hands back the
  // attestation the same way, so nothing here has to understand WebAuthn.
  const credential = await NativePasskey.create(JSON.parse(optionsJson));

  const verified = await graphqlRequest<{
    passkeyRegisterVerify: PasskeyPayload;
  }>(GQL_PASSKEY_REGISTER_VERIFY, {
    input: {
      credentialJson: JSON.stringify(credential),
      challengeToken,
      name: name || deviceLabel(),
    },
  });

  return passkeyFromGql(verified.passkeyRegisterVerify);
}

/**
 * Signs in with a passkey. No identifier is sent: the credential is
 * discoverable, so the on-device account picker already knows which account
 * it holds — and asking for an email first would make the sign-in screen an
 * account-existence oracle for no benefit.
 */
export async function signInWithPasskey(): Promise<{ token: string; user: User }> {
  const options = await graphqlRequest<{ passkeyAuthOptions: ChallengePayload }>(
    GQL_PASSKEY_AUTH_OPTIONS,
  );

  const { optionsJson, challengeToken } = options.passkeyAuthOptions;
  const credential = await NativePasskey.get(JSON.parse(optionsJson));

  const data = await graphqlRequest<{
    passkeyAuthVerify: { token: string; user: UserPayload };
  }>(GQL_PASSKEY_AUTH_VERIFY, {
    input: {
      credentialJson: JSON.stringify(credential),
      challengeToken,
      deviceLabel: deviceLabel(),
    },
  });

  return {
    token: data.passkeyAuthVerify.token,
    user: userFromGql(data.passkeyAuthVerify.user),
  };
}

export async function renamePasskey(id: string, name: string): Promise<Passkey> {
  const data = await graphqlRequest<{ renamePasskey: PasskeyPayload }>(GQL_RENAME_PASSKEY, {
    input: { id, name },
  });
  return passkeyFromGql(data.renamePasskey);
}

export async function deletePasskey(id: string): Promise<void> {
  await graphqlRequest<{ deletePasskey: boolean }>(GQL_DELETE_PASSKEY, { id });
}
