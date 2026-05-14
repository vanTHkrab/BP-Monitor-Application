// Phone/password constraints. Shared by DTOs so the wire contract is
// defined in one place.
export const PHONE_REGEX = /^[0-9]{9,15}$/; // digits only, 9-15 long (covers TH + intl)
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt's hard input limit

// Keep the JWT payload minimal — only the identifiers the guard needs to
// re-resolve the user. Anything else (phone, role, profile) is loaded from
// the DB on demand so it stays consistent with the source of truth and so a
// leaked token doesn't leak PII along with it.
export interface JwtPayload {
  sub: string; // user id
  sid: string; // session id
}

export interface CurrentUserContext {
  id: string;
  sessionId: string;
}

export type Gender = 'male' | 'female' | 'other';
