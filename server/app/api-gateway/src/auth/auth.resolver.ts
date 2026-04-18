import { UseGuards } from '@nestjs/common';
import {
  Args,
  Context,
  Field,
  Float,
  InputType,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { GqlAuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import {
  AuthPayload,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  SessionType,
  UserType,
} from './auth.types';

@InputType()
export class UpdateProfileInput {
  @Field({ nullable: true }) firstname?: string;
  @Field({ nullable: true }) lastname?: string;
  @Field({ nullable: true }) phone?: string;
  @Field({ nullable: true }) email?: string;
  @Field({ nullable: true }) dob?: Date;
  @Field({ nullable: true }) gender?: string;
  @Field(() => Float, { nullable: true }) weight?: number;
  @Field(() => Float, { nullable: true }) height?: number;
  @Field({ nullable: true }) congenitalDisease?: string;
  @Field({ nullable: true }) avatar?: string;
}

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayload, { description: 'ลงทะเบียนผู้ใช้ใหม่' })
  async register(
    @Args('input') input: RegisterInput,
    @Context() context: any,
  ): Promise<AuthPayload> {
    const userAgent =
      context?.reply?.request?.headers?.['user-agent'] ??
      context?.req?.headers?.['user-agent'];
    return this.authService.register(input, userAgent);
  }

  @Mutation(() => AuthPayload, { description: 'เข้าสู่ระบบ' })
  async login(
    @Args('input') input: LoginInput,
    @Context() context: any,
  ): Promise<AuthPayload> {
    const userAgent =
      context?.reply?.request?.headers?.['user-agent'] ??
      context?.req?.headers?.['user-agent'];
    return this.authService.login(input, userAgent);
  }

  @Query(() => UserType, { description: 'ดึงข้อมูลผู้ใช้ปัจจุบัน' })
  @UseGuards(GqlAuthGuard)
  async me(@CurrentUser() user: { id: string }): Promise<UserType> {
    return this.authService.me(user.id);
  }

  @Mutation(() => UserType, { description: 'แก้ไขโปรไฟล์' })
  @UseGuards(GqlAuthGuard)
  async updateProfile(
    @CurrentUser() user: { id: string },
    @Args('input') input: UpdateProfileInput,
  ): Promise<UserType> {
    return this.authService.updateProfile(user.id, input);
  }

  @Mutation(() => Boolean, { description: 'เปลี่ยนรหัสผ่านผู้ใช้' })
  @UseGuards(GqlAuthGuard)
  async changePassword(
    @CurrentUser() user: { id: string },
    @Args('input') input: ChangePasswordInput,
  ): Promise<boolean> {
    return this.authService.changePassword(
      user.id,
      input.currentPassword,
      input.newPassword,
    );
  }

  @Query(() => [SessionType], { description: 'ประวัติการเข้าสู่ระบบ' })
  @UseGuards(GqlAuthGuard)
  async loginSessions(
    @CurrentUser() user: { id: string },
  ): Promise<SessionType[]> {
    return this.authService.listSessions(user.id);
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
