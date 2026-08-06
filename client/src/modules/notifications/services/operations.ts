/**
 * The notifications module's GraphQL operations.
 *
 * Both mutations are guarded on the gateway, so neither is callable before a
 * session exists — which is also why registration is driven off the auth store
 * rather than off app start (see `bootstrap.ts`).
 *
 * Validated against `server/app/api-gateway/src/schema.gql` by
 * `pnpm verify-graphql`, which runs ahead of the suite precisely because a
 * selection the server rejects is invisible to TypeScript and to Jest.
 */

/**
 * Idempotent by contract: `PushService.registerToken` upserts, so the app
 * calls this on every authenticated launch without having to track whether it
 * already did.
 */
export const GQL_REGISTER_PUSH_TOKEN = `
  mutation RegisterPushToken($input: RegisterPushTokenInput!) {
    registerPushToken(input: $input)
  }
`;

/**
 * Used when the OS says permission is gone but the device still remembers a
 * token it registered. Logout has its own path — `logout(pushToken:)` — so
 * this is only for "notifications were turned off without signing out".
 */
export const GQL_UNREGISTER_PUSH_TOKEN = `
  mutation UnregisterPushToken($token: String!) {
    unregisterPushToken(token: $token)
  }
`;
