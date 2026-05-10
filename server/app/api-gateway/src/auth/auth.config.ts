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

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '30d';
export const BCRYPT_SALT_ROUNDS = 10;
