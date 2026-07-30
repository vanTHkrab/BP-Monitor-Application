import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthPayloadObject } from './dto/auth-payload.object';
import { ChangePasswordInput } from './dto/change-password.input';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { SessionObject } from './dto/session.object';
import { UpdateProfileInput } from './dto/update-profile.input';
import { UserObject } from './dto/user.object';

interface GraphQLContextWithRequest {
  req?: { headers?: Record<string, string | string[] | undefined> };
  reply?: {
    request?: { headers?: Record<string, string | string[] | undefined> };
  };
}

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
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayloadObject, { description: 'ลงทะเบียนผู้ใช้ใหม่' })
  async register(
    @Args('input') input: RegisterInput,
    @Context() context: GraphQLContextWithRequest,
  ): Promise<AuthPayloadObject> {
    return this.authService.register(input, readUserAgent(context));
  }

  // Throttling is Better Auth's now — `rateLimit.customRules` covers
  // /sign-in/phone-number and /sign-in/email alike, so adding a credential
  // route no longer means remembering to guard it.
  @Mutation(() => AuthPayloadObject, { description: 'เข้าสู่ระบบ' })
  async login(
    @Args('input') input: LoginInput,
    @Context() context: GraphQLContextWithRequest,
  ): Promise<AuthPayloadObject> {
    return this.authService.login(input, readUserAgent(context));
  }

  @Query(() => UserObject, { description: 'ดึงข้อมูลผู้ใช้ปัจจุบัน' })
  @UseGuards(GqlAuthGuard)
  async me(@CurrentUser() user: { id: string }): Promise<UserObject> {
    return this.authService.me(user.id);
  }

  @Mutation(() => UserObject, { description: 'แก้ไขโปรไฟล์' })
  @UseGuards(GqlAuthGuard)
  async updateProfile(
    @CurrentUser() user: { id: string },
    @Args('input') input: UpdateProfileInput,
  ): Promise<UserObject> {
    return this.authService.updateProfile(user.id, input);
  }

  @Mutation(() => Boolean, { description: 'เปลี่ยนรหัสผ่านผู้ใช้' })
  @UseGuards(GqlAuthGuard)
  async changePassword(
    @CurrentUser() user: { id: string; sessionId: string },
    @Args('input') input: ChangePasswordInput,
  ): Promise<boolean> {
    return this.authService.changePassword(
      user.id,
      user.sessionId,
      input.currentPassword,
      input.newPassword,
    );
  }

  @Mutation(() => Boolean, {
    description: 'ยืนยันรหัสผ่าน (สำหรับปลดล็อกข้อมูลละเอียดอ่อน)',
  })
  @UseGuards(GqlAuthGuard)
  async verifyPassword(
    @CurrentUser() user: { id: string },
    @Args('password') password: string,
  ): Promise<boolean> {
    return this.authService.verifyPassword(user.id, password);
  }

  @Query(() => [SessionObject], { description: 'ประวัติการเข้าสู่ระบบ' })
  @UseGuards(GqlAuthGuard)
  async loginSessions(
    @CurrentUser() user: { id: string },
  ): Promise<SessionObject[]> {
    return this.authService.listSessions(user.id);
  }

  @Mutation(() => Boolean, { description: 'ออกจากระบบเฉพาะอุปกรณ์ปัจจุบัน' })
  @UseGuards(GqlAuthGuard)
  async logout(
    @CurrentUser() user: { id: string; sessionId: string },
  ): Promise<boolean> {
    return this.authService.logout(user.id, user.sessionId);
  }

  @Mutation(() => Boolean, { description: 'ออกจากระบบทุกอุปกรณ์' })
  @UseGuards(GqlAuthGuard)
  async logoutAllDevices(
    @CurrentUser() user: { id: string; sessionId?: string },
  ): Promise<boolean> {
    return this.authService.logoutAllDevices(user.id, user.sessionId);
  }

  @Mutation(() => Boolean, { description: 'ลบข้อมูลผู้ใช้ทั้งหมด' })
  @UseGuards(GqlAuthGuard)
  async deleteMyData(@CurrentUser() user: { id: string }): Promise<boolean> {
    return this.authService.deleteMyData(user.id);
  }
}
