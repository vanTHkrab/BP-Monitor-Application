// Phone/password constraints. Shared by DTOs so the wire contract is
// defined in one place.
export const PHONE_REGEX = /^[0-9]{9,15}$/; // digits only, 9-15 long (covers TH + intl)
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt's hard input limit

export interface JwtPayload {
  sub: string; // user id
  phone: string;
  sid: string; // session id
}

export interface CurrentUserContext {
  id: string;
  phone: string;
  sessionId: string;
}

export type Gender = 'male' | 'female' | 'other';
