/** Which method the account last signed in with. Mirrors the gateway's column. */
export type LoginMethod = 'email' | 'phone-number' | 'google' | 'passkey';

export type Passkey = {
  id: string;
  /** User-chosen label. Absent for a credential registered without one. */
  name?: string;
  /**
   * True when the credential is synced to the user's account (Google Password
   * Manager and friends). False means it lives on this device only — losing
   * the phone loses the passkey, which is why the UI says so out loud.
   */
  backedUp: boolean;
  deviceType?: string;
  createdAt: Date;
};

export type SecurityOverview = {
  lastLoginMethod?: LoginMethod;
  passkeyCount: number;
  activeSessionCount: number;
  /** False for an account created through Google alone — it has no password to change. */
  hasPassword: boolean;
  hasGoogleAccount: boolean;
  emailVerified: boolean;
  /** False when the server has no passkey RP configured. The UI hides the section. */
  passkeySupported: boolean;
};
