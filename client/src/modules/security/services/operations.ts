/**
 * The security-screen GraphQL operations.
 *
 * Field lists mirror `SecurityOverviewType` / `PasskeyType` in
 * `server/app/api-gateway/src/schema.gql`.
 */

const PASSKEY_FIELDS = `
  id
  name
  backedUp
  deviceType
  createdAt
`;

export const GQL_SECURITY_OVERVIEW = `
  query SecurityOverview {
    securityOverview {
      lastLoginMethod
      passkeyCount
      activeSessionCount
      hasPassword
      hasGoogleAccount
      emailVerified
      passkeySupported
    }
  }
`;

export const GQL_PASSKEYS = `
  query Passkeys {
    passkeys { ${PASSKEY_FIELDS} }
  }
`;

/**
 * Both ceremonies are two mutations, not a mutation and a query.
 *
 * The options call mints a single-use challenge, so a client that cached it —
 * which is exactly what a GraphQL client may do with a query — would replay a
 * spent challenge and fail verification with an error pointing at the
 * authenticator instead of at the cache.
 */
export const GQL_PASSKEY_REGISTER_OPTIONS = `
  mutation PasskeyRegisterOptions {
    passkeyRegisterOptions {
      optionsJson
      challengeToken
    }
  }
`;

export const GQL_PASSKEY_REGISTER_VERIFY = `
  mutation PasskeyRegisterVerify($input: PasskeyRegisterVerifyInput!) {
    passkeyRegisterVerify(input: $input) { ${PASSKEY_FIELDS} }
  }
`;

export const GQL_PASSKEY_AUTH_OPTIONS = `
  mutation PasskeyAuthOptions {
    passkeyAuthOptions {
      optionsJson
      challengeToken
    }
  }
`;

export const GQL_PASSKEY_AUTH_VERIFY = `
  mutation PasskeyAuthVerify($input: PasskeyAuthenticateVerifyInput!) {
    passkeyAuthVerify(input: $input) {
      token
      user {
        id
        firstname
        lastname
        phone
        email
        emailVerified
        avatar
        role
        roleSelectedAt
        createdAt
        dob
        gender
        weight
        height
        congenitalDisease
      }
    }
  }
`;

export const GQL_RENAME_PASSKEY = `
  mutation RenamePasskey($input: RenamePasskeyInput!) {
    renamePasskey(input: $input) { ${PASSKEY_FIELDS} }
  }
`;

export const GQL_DELETE_PASSKEY = `
  mutation DeletePasskey($id: ID!) {
    deletePasskey(id: $id)
  }
`;
