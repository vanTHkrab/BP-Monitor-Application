import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import type { BetterAuthInstance } from '../auth/better-auth';
import { InjectBetterAuth } from '../auth/better-auth.token';
import { PrismaService } from '../prisma/prisma.service';
import { PasskeyChallengeObject } from './dto/passkey-challenge.object';
import { PasskeyObject } from './dto/passkey.object';
import { SecurityOverviewObject } from './dto/security-overview.object';

/**
 * Passkey management and the security-screen summary.
 *
 * Split from `AuthService` on a deliberate line: `auth/` owns *getting in*
 * (register, sign in, session lifecycle), this owns *managing how you get in*.
 * The one place that blurs — signing in with a passkey — lives here anyway,
 * because splitting a two-call WebAuthn ceremony across two modules would put
 * the challenge relay in one file and the verification in another.
 */

/** Better Auth's APIError carries its own status; anything else is a 500. */
function readStatus(error: unknown): number {
  const status = (error as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' ? status : HttpStatus.INTERNAL_SERVER_ERROR;
}

function readMessage(error: unknown): string | undefined {
  const body = (error as { body?: { message?: unknown } })?.body;
  if (typeof body?.message === 'string') return body.message;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : undefined;
}

/** The columns every `PasskeyObject` is built from. One place, so the register
 *  response and a later list call cannot disagree. */
const PASSKEY_SELECT = {
  id: true,
  name: true,
  backedUp: true,
  deviceType: true,
  createdAt: true,
} as const;

/**
 * The authenticator's assertion, as the plugin types it.
 *
 * Derived from the endpoint signature rather than imported from
 * `@simplewebauthn/*`: that package is a transitive dependency of the plugin,
 * not one this service declares, and importing it directly would be a package
 * that no manifest justifies. Deriving it also means a plugin upgrade that
 * changes the shape fails here at compile time instead of at the first
 * sign-in.
 */
type AuthenticationResponse = NonNullable<
  Parameters<BetterAuthInstance['api']['verifyPasskeyAuthentication']>[0]
>['body']['response'];

type PasskeyRow = {
  id: string;
  name: string | null;
  backedUp: boolean;
  deviceType: string;
  createdAt: Date;
};

function toPasskeyObject(row: PasskeyRow): PasskeyObject {
  return {
    id: row.id,
    name: row.name ?? undefined,
    backedUp: row.backedUp,
    deviceType: row.deviceType || undefined,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class SecurityService {
  constructor(
    @InjectBetterAuth() private readonly auth: BetterAuthInstance,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * True when this deployment can do passkeys at all.
   *
   * The plugin is only registered when `PASSKEY_RP_ID` is set (see
   * better-auth.ts), so the absence of its endpoints is the honest signal —
   * more reliable than re-reading the env var here, because it also catches a
   * plugin that failed to load for some other reason. The client hides the
   * whole passkey section on a false rather than offering a button that dies
   * at the authenticator with an opaque error.
   */
  get passkeySupported(): boolean {
    return typeof this.auth.api.listPasskeys === 'function';
  }

  private requirePasskeySupport(): void {
    if (this.passkeySupported) return;
    throw new HttpException(
      { message: 'เซิร์ฟเวอร์นี้ยังไม่เปิดใช้งาน passkey' },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async overview(userId: string): Promise<SecurityOverviewObject> {
    const [user, passkeyCount, activeSessionCount, accounts] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { lastLoginMethod: true, emailVerified: true },
        }),
        this.passkeySupported
          ? this.prisma.passkey.count({ where: { userId } })
          : Promise.resolve(0),
        // Nothing ever flips `isActive` to false on natural expiry — only an
        // explicit logout does (see AuthService.logout /
        // logoutAllDevices). Without the `expiresAt` gate, a session that
        // simply expired stays counted here forever, and this number drives
        // the security hub's headline warning
        // ("มี N อุปกรณ์ที่เข้าสู่ระบบอยู่") before the user ever reaches the
        // devices screen. Unlike `AuthService.listSessions`, nothing
        // downstream needs to bucket expired vs. revoked here — it's a raw
        // count — so filtering in the query is the right shape, not a
        // computed field over mapped rows.
        this.prisma.userSession.count({
          where: { userId, isActive: true, expiresAt: { gt: new Date() } },
        }),
        this.prisma.account.findMany({
          where: { userId },
          select: { providerId: true, password: true },
        }),
      ]);

    if (!user) throw new UnauthorizedException('ไม่พบผู้ใช้');

    return {
      lastLoginMethod: user.lastLoginMethod ?? undefined,
      passkeyCount,
      activeSessionCount,
      // The credential lives on the account row, not on `users`: an account
      // created through Google alone has no password at all, and the UI must
      // not offer "change password" to someone who has none to change.
      hasPassword: accounts.some(
        (account) => account.providerId === 'credential' && account.password,
      ),
      hasGoogleAccount: accounts.some(
        (account) => account.providerId === 'google',
      ),
      emailVerified: user.emailVerified,
      passkeySupported: this.passkeySupported,
    };
  }

  async listPasskeys(userId: string): Promise<PasskeyObject[]> {
    if (!this.passkeySupported) return [];

    const passkeys = await this.prisma.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: PASSKEY_SELECT,
    });

    return passkeys.map(toPasskeyObject);
  }

  /** Step one of registering a new authenticator for a signed-in user. */
  async registerOptions(
    userId: string,
    sessionId: string,
  ): Promise<PasskeyChallengeObject> {
    this.requirePasskeySupport();
    const headers = await this.sessionHeaders(userId, sessionId);

    const { headers: responseHeaders, response } = await this.callAuth(() =>
      this.auth.api.generatePasskeyRegistrationOptions({
        headers,
        returnHeaders: true,
      }),
    );

    return {
      optionsJson: JSON.stringify(response),
      challengeToken: this.extractChallengeCookie(responseHeaders),
    };
  }

  /** Step two: hand the authenticator's attestation back to the plugin. */
  async registerVerify(
    userId: string,
    sessionId: string,
    credentialJson: string,
    challengeToken: string,
    name?: string,
  ): Promise<PasskeyObject> {
    this.requirePasskeySupport();

    const headers = await this.sessionHeaders(userId, sessionId);
    headers.set('cookie', challengeToken);

    const result = await this.callAuth(() =>
      this.auth.api.verifyPasskeyRegistration({
        headers,
        body: { response: this.parseCredential(credentialJson), name },
      }),
    );

    const created = await this.prisma.passkey.findFirst({
      where: { userId, id: (result as { id?: string })?.id },
      select: PASSKEY_SELECT,
    });

    if (!created) {
      throw new HttpException(
        { message: 'ลงทะเบียน passkey ไม่สำเร็จ' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return toPasskeyObject(created);
  }

  /**
   * Step one of signing in. Public by necessity — the caller has no session
   * yet, which is the entire point of the ceremony.
   *
   * No identifier is accepted: the credential is discoverable
   * (`residentKey: 'required'`), so the authenticator already knows which
   * account it holds. Taking an email here would turn an unauthenticated
   * endpoint into an account-existence oracle and buy nothing.
   */
  async authenticateOptions(): Promise<PasskeyChallengeObject> {
    this.requirePasskeySupport();

    const { headers, response } = await this.callAuth(() =>
      this.auth.api.generatePasskeyAuthenticationOptions({
        returnHeaders: true,
      }),
    );

    return {
      optionsJson: JSON.stringify(response),
      challengeToken: this.extractChallengeCookie(headers),
    };
  }

  /** Step two of signing in: returns the session token the client stores. */
  async authenticateVerify(
    credentialJson: string,
    challengeToken: string,
    userAgent?: string,
    deviceLabel?: string,
  ): Promise<{ token: string; userId: string }> {
    this.requirePasskeySupport();

    const headers = new Headers();
    headers.set('cookie', challengeToken);
    if (userAgent) headers.set('user-agent', userAgent);

    const result = await this.callAuth(
      () =>
        this.auth.api.verifyPasskeyAuthentication({
          headers,
          // The cast asserts shape, not trust: `parseCredential` has already
          // rejected anything that is not a JSON object, and the plugin
          // verifies every field cryptographically before it means anything.
          body: {
            response: this.parseCredential(
              credentialJson,
            ) as unknown as AuthenticationResponse,
          },
        }),
      // The plugin distinguishes an unknown credential from a failed
      // signature. The client must not: either way the answer is "this device
      // cannot sign you in", and the difference tells a caller which
      // credentials exist.
      () => new UnauthorizedException('ยืนยันตัวตนด้วย passkey ไม่สำเร็จ'),
    );

    const session = (result as { session?: { token?: string } })?.session;
    const user = (result as { user?: { id?: string } })?.user;

    if (!session?.token || !user?.id) {
      throw new UnauthorizedException('ยืนยันตัวตนด้วย passkey ไม่สำเร็จ');
    }

    // `deviceLabel` is this app's column, not Better Auth's; the plugin's
    // sign-in has no slot for it, so it is written straight after.
    await this.prisma.userSession.updateMany({
      where: { token: session.token },
      data: { deviceLabel: deviceLabel || 'Mobile App' },
    });

    return { token: session.token, userId: user.id };
  }

  async renamePasskey(
    userId: string,
    sessionId: string,
    id: string,
    name: string,
  ): Promise<PasskeyObject> {
    this.requirePasskeySupport();
    await this.requireOwnedPasskey(userId, id);

    const headers = await this.sessionHeaders(userId, sessionId);
    await this.callAuth(() =>
      this.auth.api.updatePasskey({ headers, body: { id, name } }),
    );

    const updated = await this.prisma.passkey.findFirst({
      where: { id, userId },
      select: PASSKEY_SELECT,
    });

    if (!updated) throw new NotFoundException('ไม่พบ passkey นี้');

    return toPasskeyObject(updated);
  }

  /**
   * Removing a passkey is not symmetric with adding one.
   *
   * If it is the account's last passkey and the account has no password,
   * deleting it locks the user out with no recovery path this app can offer.
   * The check lives here rather than in the UI because the UI is not the only
   * caller of a GraphQL API.
   */
  async deletePasskey(
    userId: string,
    sessionId: string,
    id: string,
  ): Promise<boolean> {
    this.requirePasskeySupport();
    await this.requireOwnedPasskey(userId, id);

    const [remaining, credential] = await Promise.all([
      this.prisma.passkey.count({ where: { userId, NOT: { id } } }),
      this.prisma.account.findFirst({
        where: { userId, providerId: 'credential', NOT: { password: null } },
        select: { id: true },
      }),
    ]);

    if (remaining === 0 && !credential) {
      throw new BadRequestException(
        'ลบไม่ได้ เพราะนี่เป็นวิธีเข้าสู่ระบบเดียวที่เหลืออยู่ — ตั้งรหัสผ่านก่อนแล้วจึงลบ',
      );
    }

    const headers = await this.sessionHeaders(userId, sessionId);
    await this.callAuth(() =>
      this.auth.api.deletePasskey({ headers, body: { id } }),
    );

    return true;
  }

  // ── Helpers ──

  private async requireOwnedPasskey(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.passkey.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    // Same exception for "does not exist" and "belongs to someone else": the
    // difference is only useful to someone enumerating ids.
    if (!owned) throw new NotFoundException('ไม่พบ passkey นี้');
  }

  /**
   * Lifts Better Auth's challenge cookie out of the response headers so it can
   * travel back to the client as an ordinary GraphQL field.
   *
   * The plugin's two calls are joined by a signed cookie. The mobile client
   * authenticates with a bearer token and has no cookie jar, so without this
   * relay every verification fails with "challenge not found" — a message that
   * points at the authenticator rather than at the transport, which is why it
   * is worth the explanation.
   *
   * Only the `name=value` pairs are kept. The attributes (Path, HttpOnly,
   * SameSite) describe browser storage this value will never see, and sending
   * them back would make the request's Cookie header malformed.
   */
  private extractChallengeCookie(headers: Headers): string {
    const setCookie = headers.get('set-cookie');

    if (!setCookie) {
      throw new HttpException(
        { message: 'ไม่สามารถเริ่มขั้นตอน passkey ได้' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // `Headers.get` joins multiple Set-Cookie values with ", ", and cookie
    // attributes (notably Expires) contain commas of their own — so the split
    // has to look ahead for the `name=` that starts the next cookie.
    return setCookie
      .split(/,(?=\s*[^;=,]+=)/)
      .map((cookie) => cookie.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }

  /** The credential blob is client-supplied, so parsing it is a validation step. */
  private parseCredential(credentialJson: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(credentialJson);
    } catch {
      throw new BadRequestException('ข้อมูล passkey ไม่ถูกต้อง');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('ข้อมูล passkey ไม่ถูกต้อง');
    }

    return parsed as Record<string, unknown>;
  }

  /**
   * Authenticates a Better Auth call as the caller's own session.
   *
   * Mirrors `AuthService.headersForSession` rather than importing it: that one
   * is private to a service in another module, and exporting it to share eight
   * lines would couple two modules on an internal. A third caller is the point
   * at which this should be lifted into a shared helper.
   */
  private async sessionHeaders(
    userId: string,
    sessionId: string,
  ): Promise<Headers> {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId, isActive: true },
      select: { token: true },
    });

    if (!session) {
      throw new UnauthorizedException('Session is no longer active');
    }

    const headers = new Headers();
    headers.set('authorization', `Bearer ${session.token}`);
    return headers;
  }

  /**
   * Keeps Better Auth's `APIError` from escaping past `errorFormatter`, which
   * is what stamps `extensions.code` — the field the mobile client's 401
   * fan-out keys off. Same reasoning as `AuthService.callAuth`.
   */
  private async callAuth<T>(
    call: () => Promise<T>,
    onFailure?: (error: unknown) => HttpException,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (onFailure) throw onFailure(error);

      const status = readStatus(error);
      const message = readMessage(error) ?? 'ไม่สามารถดำเนินการได้';
      throw new HttpException({ message }, status);
    }
  }
}
