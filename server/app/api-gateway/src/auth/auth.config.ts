// Auth-related configuration. Centralizes JWT secret resolution so we don't
// duplicate the literal across guard and service, and so a missing secret in
// production fails loudly at boot instead of silently signing tokens with a
// well-known fallback.

let cachedSecret: string | null = null;

export const getJwtSecret = (): string => {
  if (cachedSecret) return cachedSecret;

  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Refusing to boot — set a strong, random ' +
        'value in server/app/api-gateway/.env (do not commit it).',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `JWT_SECRET is too short (${secret.length} chars). Use at least 32 ` +
        'characters of randomness.',
    );
  }

  cachedSecret = secret;
  return cachedSecret;
};

// 7d is a deliberate trade-off: long enough that mobile users don't re-login
// every day, short enough that a leaked token's exposure window is bounded.
// Override via env when running a flow that needs a longer-lived token
// (e.g. integration tests). When refresh-token rotation lands this should
// drop further (target: 15m access + 7d refresh).
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
export const BCRYPT_SALT_ROUNDS = 10;
