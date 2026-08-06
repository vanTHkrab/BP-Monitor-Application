import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import type { BetterAuthInstance } from './better-auth';
import { InjectBetterAuth } from './better-auth.token';
import { StorageService } from '../storage/storage.service';
import { JWT_EXPIRES_IN, SESSION_TTL_MS, getJwtSecret } from './auth.config';
import { AuthPayloadObject } from './dto/auth-payload.object';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { UserObject } from './dto/user.object';
import {
  Gender,
  JwtPayload,
  normalizeSelfAssignedRole,
} from './types/auth.types';

// Verify-password throttle (per-userId, in-memory). Tighter than the login
// throttle because the caller is already authenticated — a wrong guess on
// this endpoint means someone with the user's token is fishing for the
// password. Move to Redis alongside the login throttle migration (PLAN P0 #2).
const VERIFY_PASSWORD_WINDOW_MS = 5 * 60 * 1000;
const VERIFY_PASSWORD_MAX_ATTEMPTS = 3;

interface VerifyAttempt {
  count: number;
  windowStart: number;
}

/** Better Auth's APIError carries its HTTP status; anything else is a 500. */
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

@Injectable()
export class AuthService {
  private readonly verifyAttempts = new Map<string, VerifyAttempt>();

  constructor(
    @InjectBetterAuth() private readonly auth: BetterAuthInstance,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly push: PushService,
  ) {}

  /**
   * Wraps Better Auth's sign-up. The resolver keeps owning the GraphQL
   * contract; Better Auth owns credential creation, so the password is
   * hashed, stored on the credential account, and checked against known
   * breaches by the same code path a REST caller would take.
   *
   * The uniqueness pre-checks stay because they produce the Thai
   * ConflictException messages the client renders inline; Better Auth's own
   * error would surface as a generic failure.
   */
  async register(
    input: RegisterInput,
    userAgent?: string,
  ): Promise<AuthPayloadObject> {
    const existing = await this.prisma.user.findUnique({
      where: { phone: input.phone },
    });

    if (existing) {
      throw new ConflictException('เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว');
    }

    const existingEmail = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingEmail) {
      throw new ConflictException('อีเมลนี้ถูกใช้งานแล้ว');
    }

    const result = await this.callAuth(() =>
      this.auth.api.signUpEmail({
        headers: this.headersFor(userAgent),
        body: {
          email: input.email,
          password: input.password,
          // Better Auth's required display name, derived so it cannot drift
          // from the two domain columns.
          name: `${input.firstname} ${input.lastname}`.trim(),
          firstname: input.firstname,
          lastname: input.lastname,
          phoneNumber: input.phone,
          dob: input.dob ?? null,
          gender: (input.gender as Gender | undefined) ?? null,
          weight: input.weight ?? null,
          height: input.height ?? null,
          congenitalDisease: input.congenitalDisease ?? null,
        },
      }),
    );

    // Avatar is ours, not Better Auth's: it is normalised to a storage key
    // before writing so the database never holds a signed URL.
    const avatar = this.storage.normalizeStorageValue(input.avatar);
    if (avatar) {
      await this.prisma.user.update({
        where: { id: result.user.id },
        data: { avatar },
      });
    }

    // No role is set here on purpose. Every account starts as `patient` with
    // `roleSelectedAt` null, and the onboarding step that follows calls
    // `selectRole`. One grant point, and a Google sign-up — which never sees
    // RegisterInput — gets the same choice.

    await this.labelSession(result.token, input.deviceLabel);

    return {
      token: this.requireToken(result.token),
      user: await this.me(result.user.id),
    };
  }

  /**
   * Wraps Better Auth's phone sign-in.
   *
   * Rate limiting is no longer this method's problem: Better Auth throttles
   * `/sign-in/phone-number` by configuration, which also covers the email
   * route that login-throttle.guard.ts never knew about.
   */
  async login(
    input: LoginInput,
    userAgent?: string,
  ): Promise<AuthPayloadObject> {
    const result = await this.callAuth(
      () =>
        this.auth.api.signInPhoneNumber({
          headers: this.headersFor(userAgent),
          body: { phoneNumber: input.phone, password: input.password },
        }),
      // Better Auth distinguishes "no such phone" from "wrong password"; the
      // client must not, or the endpoint becomes a phone-number oracle.
      () => new UnauthorizedException('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง'),
    );

    if (!result.user) {
      throw new UnauthorizedException('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง');
    }

    await this.labelSession(result.token, input.deviceLabel);

    return {
      token: this.requireToken(result.token),
      user: await this.me(result.user.id),
    };
  }

  /**
   * Signs in with a Google ID token obtained on-device.
   *
   * This is the mobile half of "One Tap". Better Auth ships a `oneTap` plugin,
   * but it is built around Google Identity Services in a browser — it expects
   * the GIS script to run and a cookie to come back. Android has no such
   * script: the account picker is Credential Manager, which hands the app an
   * ID token directly. So the token is exchanged here instead, through the
   * same `signInSocial` path the browser redirect ends at, which means account
   * linking, the `patient` default role, and session creation all behave
   * identically no matter which door the user came through.
   *
   * The token is *not* trusted because the client sent it: Better Auth
   * verifies Google's signature, issuer, and audience. `GOOGLE_ANDROID_CLIENT_ID`
   * has to be configured for the audience check to pass — see `googleProvider()`.
   */
  async loginWithGoogleIdToken(
    idToken: string,
    userAgent?: string,
    deviceLabel?: string,
  ): Promise<AuthPayloadObject> {
    const result = await this.callAuth(
      () =>
        this.auth.api.signInSocial({
          headers: this.headersFor(userAgent),
          body: { provider: 'google', idToken: { token: idToken } },
        }),
      () => new UnauthorizedException('เข้าสู่ระบบด้วย Google ไม่สำเร็จ'),
    );

    // `signInSocial` is shared with the browser redirect flow, whose result is
    // a URL to navigate to and no session at all. The ID-token exchange always
    // takes the other branch, so reaching this one means the provider is
    // misconfigured rather than that the user did something wrong — but it is
    // a real union, and returning a URL as a token would be worse than a 401.
    if (!('token' in result) || !result.token || !result.user) {
      throw new UnauthorizedException('เข้าสู่ระบบด้วย Google ไม่สำเร็จ');
    }

    await this.labelSession(result.token, deviceLabel);

    return {
      token: this.requireToken(result.token),
      user: await this.me(result.user.id),
    };
  }

  async me(userId: string): Promise<UserObject> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('ไม่พบผู้ใช้');
    }

    return this.toUserType(user);
  }

  /**
   * Applies the role the user picked in onboarding.
   *
   * Deliberately re-callable: `role` is a UI mode, not an authorization
   * boundary — data access is gated on an *accepted* CaregiverPatient link,
   * not on this column — so a settings screen can reuse this to let someone
   * fix a mis-tap. The only thing that must never be self-assigned is
   * `developer`, and `normalizeSelfAssignedRole` is what guarantees that.
   *
   * It runs here even though the DTO enum already constrained the value:
   * this is the write that assigns the role, so it does not depend on a
   * caller further up having validated first.
   *
   * `roleSelectedAt` is what the client's onboarding gate reads. Setting it
   * on every call is intentional — re-choosing is still choosing.
   */
  async selectRole(userId: string, role: string): Promise<UserObject> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        role: normalizeSelfAssignedRole(role),
        roleSelectedAt: new Date(),
      },
    });

    return this.me(userId);
  }

  async updateProfile(
    userId: string,
    data: {
      firstname?: string;
      lastname?: string;
      phone?: string;
      email?: string;
      dob?: Date;
      gender?: string;
      weight?: number;
      height?: number;
      congenitalDisease?: string;
      avatar?: string;
    },
  ): Promise<UserObject> {
    if (data.phone) {
      const existingPhone = await this.prisma.user.findUnique({
        where: { phone: data.phone },
      });

      if (existingPhone && existingPhone.id !== userId) {
        throw new ConflictException('เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว');
      }
    }

    // A-006. Better Auth lowercases on every path it owns (sign-up, sign-in,
    // change-email); this one writes through Prisma directly and so bypassed
    // that, and was the only way a mixed-case address could enter the column.
    //
    // Normalising here rather than at the reads fixes both halves at once.
    // The `findUnique` below is exact-match on a `@unique` column, so a stored
    // `Foo@x.com` is invisible to a lookup for `foo@x.com` — which is how
    // `addCaregiverPatient`'s email lookup would fail to find a patient who
    // exists, and equally how this very uniqueness check would miss a
    // conflict and let the update fail at the database instead.
    const email = data.email?.trim().toLowerCase();

    if (email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email },
      });

      if (existingEmail && existingEmail.id !== userId) {
        throw new ConflictException('อีเมลนี้ถูกใช้งานแล้ว');
      }
    }

    const patch: Record<string, unknown> = {};
    if (data.firstname) patch.firstname = data.firstname;
    if (data.lastname) patch.lastname = data.lastname;
    if (data.phone) patch.phone = data.phone;
    // Email can no longer be cleared: it is the ownership proof account
    // linking depends on, and the column is NOT NULL as of the Better Auth
    // identity migration. An empty string is ignored rather than written.
    if (email) patch.email = email;
    if (data.dob !== undefined) patch.dob = data.dob || null;
    if (data.gender !== undefined) patch.gender = data.gender || null;
    if (data.weight !== undefined) patch.weight = data.weight ?? null;
    if (data.height !== undefined) patch.height = data.height ?? null;
    if (data.congenitalDisease !== undefined) {
      patch.congenitalDisease = data.congenitalDisease || null;
    }
    if (data.avatar !== undefined) {
      // Strip any signed-URL query strings (or accept a bare key) so the DB
      // only ever holds a stable storage key. Reads sign on the fly.
      patch.avatar = this.storage.normalizeStorageValue(data.avatar);
    }

    // `name` is Better Auth's display field and is derived from the two
    // domain columns. Renaming without recomputing it lets the two drift,
    // and nothing downstream would notice until a Better Auth response
    // showed the stale name.
    if (patch.firstname !== undefined || patch.lastname !== undefined) {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstname: true, lastname: true },
      });

      if (!current) {
        throw new UnauthorizedException('ไม่พบผู้ใช้');
      }

      const firstname =
        (patch.firstname as string | undefined) ?? current.firstname;
      const lastname =
        (patch.lastname as string | undefined) ?? current.lastname;
      patch.name = `${firstname} ${lastname}`.trim();
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: patch,
    });

    return this.toUserType(user);
  }

  /**
   * Wraps Better Auth's change-password.
   *
   * `revokeOtherSessions` is what used to be a manual logoutAllDevices call:
   * a leaked token elsewhere stops working the moment the password changes,
   * while this device stays signed in.
   */
  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const headers = await this.headersForSession(currentSessionId, userId);

    await this.callAuth(
      () =>
        this.auth.api.changePassword({
          headers,
          body: { currentPassword, newPassword, revokeOtherSessions: true },
        }),
      () => new UnauthorizedException('รหัสผ่านปัจจุบันไม่ถูกต้อง'),
    );

    return true;
  }

  // Verify the current user's password without minting a new token or
  // creating a session — used by the client's "unlock sensitive data" flow.
  // Throttled per-userId so a stolen device can't brute-force the password
  // by spamming this endpoint.
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const now = Date.now();
    const entry = this.verifyAttempts.get(userId);

    if (entry && now - entry.windowStart <= VERIFY_PASSWORD_WINDOW_MS) {
      if (entry.count >= VERIFY_PASSWORD_MAX_ATTEMPTS) {
        const retryAfterSec = Math.ceil(
          (VERIFY_PASSWORD_WINDOW_MS - (now - entry.windowStart)) / 1000,
        );
        throw new HttpException(
          {
            message: 'ยืนยันรหัสผ่านบ่อยเกินไป กรุณารอแล้วลองใหม่',
            retryAfterSec,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Delegated: the credential lives on the account row now, and comparing
    // against users.password_hash here would keep working right up until that
    // column is dropped, then fail silently for everyone.
    const valid = await this.auth.api
      .verifyPassword({
        headers: await this.headersForUser(userId),
        body: { password },
      })
      .then((result) => Boolean(result?.status))
      .catch(() => false);

    if (!valid) {
      const entry = this.verifyAttempts.get(userId);
      if (entry && now - entry.windowStart <= VERIFY_PASSWORD_WINDOW_MS) {
        entry.count += 1;
      } else {
        this.verifyAttempts.set(userId, { count: 1, windowStart: now });
      }
      throw new UnauthorizedException('รหัสผ่านไม่ถูกต้อง');
    }

    // Success → clear any failed-attempt counter for this user.
    this.verifyAttempts.delete(userId);
    return true;
  }

  async listSessions(userId: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return sessions.map((session) => ({
      id: session.id,
      deviceLabel: session.deviceLabel ?? undefined,
      userAgent: session.userAgent ?? undefined,
      isActive: session.isActive,
      revokedAt: session.revokedAt ?? undefined,
      lastActiveAt: session.lastActiveAt,
      createdAt: session.createdAt,
    }));
  }

  /**
   * Signs out through Better Auth, then flips `isActive` for the history the
   * login-sessions screen shows.
   *
   * The order matters and the delegation is not optional. Revoking with Prisma
   * alone leaves the session live in Better Auth's caches — Redis secondary
   * storage, and the cookie cache if it is ever re-enabled — so `me` keeps
   * succeeding with a token the user has just signed out. Only Better Auth can
   * invalidate its own caches.
   *
   * `pushToken` is the caller's own installation token, when it has one. A
   * `PushToken` row is deliberately not tied to a session — it belongs to the
   * installation and has to survive session rotation — so nothing deletes it
   * on the way out unless it is deleted here. Skipping it leaves a signed-out
   * phone still receiving another person's critical BP readings, which on a
   * shared handset is a disclosure, not just noise.
   *
   * Optional because the caller may genuinely have no token: Expo Go on
   * Android cannot obtain one at all (remote push was dropped in SDK 53), and
   * a logout must not fail over a device that could never register.
   */
  async logout(userId: string, sessionId: string, pushToken?: string) {
    if (pushToken) {
      await this.push.unregisterToken(userId, pushToken);
    }

    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId, isActive: true },
      select: { token: true },
    });

    if (!session) return true;

    const headers = new Headers();
    headers.set('authorization', `Bearer ${session.token}`);
    await this.callAuth(() => this.auth.api.signOut({ headers }));

    // `preserveSessionInDatabase` keeps the row; this is what marks it as
    // revoked rather than merely expired.
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    });

    return true;
  }

  /**
   * `keepPushToken` is this device's token; every *other* installation's token
   * is dropped along with its session. Without it, "sign out everywhere else"
   * would revoke the other devices' sessions while leaving them subscribed to
   * push — signed out and still being notified.
   */
  async logoutAllDevices(
    userId: string,
    currentSessionId?: string,
    keepPushToken?: string,
  ) {
    await this.push.unregisterOtherTokens(userId, keepPushToken);

    const where: Record<string, unknown> = {
      userId,
      isActive: true,
    };

    if (currentSessionId) {
      where.NOT = { id: currentSessionId };
    }

    await this.prisma.userSession.updateMany({
      where,
      data: {
        isActive: false,
        revokedAt: new Date(),
      },
    });

    return true;
  }

  async deleteMyData(userId: string) {
    await this.prisma.postLike.deleteMany({
      where: {
        userId,
      },
    });

    await this.prisma.bloodPressureReading.deleteMany({
      where: {
        userId,
      },
    });

    await this.prisma.post.deleteMany({
      where: {
        userId,
      },
    });

    return true;
  }

  // ── Helpers ──

  /**
   * Runs a Better Auth call and translates its failure into the exception the
   * client already understands.
   *
   * Better Auth throws `APIError` with its own status and body. Letting that
   * escape would bypass `errorFormatter`, so `extensions.code` would go
   * missing and the mobile client's 401 fan-out would stop firing.
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

  /**
   * Better Auth reads the caller's user agent and IP from request headers to
   * populate the session row. Only the user agent is available here — the
   * resolver receives it from the GraphQL context.
   */
  private headersFor(userAgent?: string): Headers {
    const headers = new Headers();
    if (userAgent) headers.set('user-agent', userAgent);
    return headers;
  }

  /**
   * Builds headers that authenticate as an existing session, so a call made
   * on the user's behalf is authorised as that user rather than trusting an
   * id passed in from the resolver.
   */
  private async headersForSession(
    sessionId: string,
    userId: string,
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

  /** As above, for callers that only know the user id. Picks the newest live session. */
  private async headersForUser(userId: string): Promise<Headers> {
    const session = await this.prisma.userSession.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
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
   * `deviceLabel` is ours, not Better Auth's, and the sign-in endpoints have
   * no slot for it. Written straight after the session is created.
   */
  private async labelSession(
    token: string | null | undefined,
    deviceLabel?: string,
  ): Promise<void> {
    if (!token) return;

    await this.prisma.userSession.updateMany({
      where: { token },
      data: { deviceLabel: deviceLabel || 'Mobile App' },
    });
  }

  /**
   * Better Auth types the session token as optional because some flows return
   * none. Every flow that reaches here must have one — an empty token would
   * hand the client a session it can never use.
   */
  private requireToken(token: string | null | undefined): string {
    if (!token) {
      throw new HttpException(
        { message: 'ไม่สามารถสร้างเซสชันได้' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return token;
  }

  /**
   * Columns the Better Auth identity migration added to `user_sessions`.
   *
   * This path still authenticates with a JWT that carries the session id, so
   * the token here is never presented by a client — it exists to satisfy the
   * NOT NULL + unique constraints that Better Auth will rely on once it owns
   * session creation. Random rather than derived from the id so the two
   * schemes cannot collide during the cutover.
   */
  private newSessionColumns(): { token: string; expiresAt: Date } {
    return {
      token: randomUUID(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    };
  }

  private signToken(userId: string, sessionId: string): string {
    const payload: JwtPayload = { sub: userId, sid: sessionId };
    const options: jwt.SignOptions = {
      expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    };
    return jwt.sign(payload, getJwtSecret(), options);
  }

  private async toUserType(user: {
    id: string;
    email: string | null;
    emailVerified: boolean;
    firstname: string;
    lastname: string;
    phone: string;
    avatar: string | null;
    role: string;
    roleSelectedAt: Date | null;
    createdAt: Date;
    dob: Date | null;
    gender: string | null;
    weight: number | null;
    height: number | null;
    congenitalDisease: string | null;
  }): Promise<UserObject> {
    const signedAvatar = await this.storage.signImageKey(user.avatar);
    return {
      id: user.id,
      email: user.email ?? undefined,
      emailVerified: user.emailVerified,
      firstname: user.firstname,
      lastname: user.lastname,
      phone: user.phone,
      avatar: signedAvatar ?? undefined,
      role: user.role,
      roleSelectedAt: user.roleSelectedAt ?? undefined,
      createdAt: user.createdAt,
      dob: user.dob ?? undefined,
      gender: user.gender ?? undefined,
      weight: user.weight ?? undefined,
      height: user.height ?? undefined,
      congenitalDisease: user.congenitalDisease ?? undefined,
    };
  }
}
