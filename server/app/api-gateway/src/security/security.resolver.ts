import { UseGuards } from '@nestjs/common';
import { Args, Context, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { GqlAuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPayloadObject } from '../auth/dto/auth-payload.object';
import type { CurrentUserContext } from '../auth/types/auth.types';
import { PasskeyAuthenticateVerifyInput } from './dto/passkey-authenticate-verify.input';
import { PasskeyChallengeObject } from './dto/passkey-challenge.object';
import { PasskeyRegisterVerifyInput } from './dto/passkey-register-verify.input';
import { PasskeyObject } from './dto/passkey.object';
import { RenamePasskeyInput } from './dto/rename-passkey.input';
import { SecurityOverviewObject } from './dto/security-overview.object';
import { SecurityService } from './security.service';

interface GraphQLContextWithRequest {
  req?: { headers?: Record<string, string | string[] | undefined> };
  reply?: {
    request?: { headers?: Record<string, string | string[] | undefined> };
  };
}

/** Mirrors `auth.resolver.ts` — Fastify exposes the request under either key. */
const readUserAgent = (
  context: GraphQLContextWithRequest,
): string | undefined => {
  const candidates = [
    context.reply?.request?.headers?.['user-agent'],
    context.req?.headers?.['user-agent'],
  ];
  for (const value of candidates) {
    if (typeof value === 'string') return value;
  }
  return undefined;
};

@Resolver()
export class SecurityResolver {
  constructor(
    private readonly securityService: SecurityService,
    private readonly authService: AuthService,
  ) {}

  @Query(() => SecurityOverviewObject, {
    description: 'สรุปสถานะความปลอดภัยของบัญชี สำหรับหน้าความปลอดภัย',
  })
  @UseGuards(GqlAuthGuard)
  async securityOverview(
    @CurrentUser() user: CurrentUserContext,
  ): Promise<SecurityOverviewObject> {
    return this.securityService.overview(user.id);
  }

  @Query(() => [PasskeyObject], {
    description: 'รายการ passkey ที่ลงทะเบียนไว้',
  })
  @UseGuards(GqlAuthGuard)
  async passkeys(
    @CurrentUser() user: CurrentUserContext,
  ): Promise<PasskeyObject[]> {
    return this.securityService.listPasskeys(user.id);
  }

  /**
   * A mutation rather than a query even though it only reads: it mints a
   * one-shot challenge and stores it, so caching the result — which is what a
   * GraphQL client is entitled to do with a query — would replay a spent
   * challenge and fail verification.
   */
  @Mutation(() => PasskeyChallengeObject, {
    description: 'ขั้นตอนที่ 1 ของการเพิ่ม passkey ใหม่',
  })
  @UseGuards(GqlAuthGuard)
  async passkeyRegisterOptions(
    @CurrentUser() user: CurrentUserContext,
  ): Promise<PasskeyChallengeObject> {
    return this.securityService.registerOptions(user.id, user.sessionId);
  }

  @Mutation(() => PasskeyObject, {
    description: 'ขั้นตอนที่ 2 ของการเพิ่ม passkey ใหม่',
  })
  @UseGuards(GqlAuthGuard)
  async passkeyRegisterVerify(
    @CurrentUser() user: CurrentUserContext,
    @Args('input') input: PasskeyRegisterVerifyInput,
  ): Promise<PasskeyObject> {
    return this.securityService.registerVerify(
      user.id,
      user.sessionId,
      input.credentialJson,
      input.challengeToken,
      input.name,
    );
  }

  /** Public: the caller has no session yet — that is what it is asking for. */
  @Mutation(() => PasskeyChallengeObject, {
    description: 'ขั้นตอนที่ 1 ของการเข้าสู่ระบบด้วย passkey',
  })
  async passkeyAuthOptions(): Promise<PasskeyChallengeObject> {
    return this.securityService.authenticateOptions();
  }

  @Mutation(() => AuthPayloadObject, {
    description: 'ขั้นตอนที่ 2 ของการเข้าสู่ระบบด้วย passkey',
  })
  async passkeyAuthVerify(
    @Args('input') input: PasskeyAuthenticateVerifyInput,
    @Context() context: GraphQLContextWithRequest,
  ): Promise<AuthPayloadObject> {
    const { token, userId } = await this.securityService.authenticateVerify(
      input.credentialJson,
      input.challengeToken,
      readUserAgent(context),
      input.deviceLabel,
    );

    // Same payload shape as `login`, so the client's existing session
    // bootstrap handles a passkey sign-in with no branch of its own.
    return { token, user: await this.authService.me(userId) };
  }

  @Mutation(() => PasskeyObject, { description: 'เปลี่ยนชื่อ passkey' })
  @UseGuards(GqlAuthGuard)
  async renamePasskey(
    @CurrentUser() user: CurrentUserContext,
    @Args('input') input: RenamePasskeyInput,
  ): Promise<PasskeyObject> {
    return this.securityService.renamePasskey(
      user.id,
      user.sessionId,
      input.id,
      input.name,
    );
  }

  @Mutation(() => Boolean, { description: 'ลบ passkey' })
  @UseGuards(GqlAuthGuard)
  async deletePasskey(
    @CurrentUser() user: CurrentUserContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.securityService.deletePasskey(user.id, user.sessionId, id);
  }
}
