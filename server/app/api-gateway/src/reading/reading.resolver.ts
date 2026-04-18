import { UseGuards } from '@nestjs/common';
import {
  Args,
  Field,
  Float,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReadingService } from './reading.service';

@ObjectType()
export class ReadingType {
  @Field(() => Int) id: number;
  @Field() userId: string;
  @Field({ nullable: true }) clientId?: string;
  @Field(() => Int) systolic: number;
  @Field(() => Int) diastolic: number;
  @Field(() => Int) pulse: number;
  @Field() status: string;
  @Field() measuredAt: Date;
  @Field({ nullable: true }) imageUri?: string;
  @Field({ nullable: true }) notes?: string;
  @Field() createdAt: Date;
}

@InputType()
export class CreateReadingInput {
  @Field(() => Int) systolic: number;
  @Field(() => Int) diastolic: number;
  @Field(() => Int) pulse: number;
  @Field() status: string;
  @Field() measuredAt: Date;
  @Field({ nullable: true }) clientId?: string;
  @Field({ nullable: true }) imageUri?: string;
  @Field({ nullable: true }) notes?: string;
}

@Resolver()
export class ReadingResolver {
  constructor(private readonly readingService: ReadingService) {}

  @Query(() => [ReadingType], { description: 'รายการค่าความดันของผู้ใช้' })
  @UseGuards(GqlAuthGuard)
  async readings(
    @CurrentUser() user: { id: string },
    @Args('limit', { type: () => Int, defaultValue: 200 }) limit: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
  ): Promise<ReadingType[]> {
    const rows = await this.readingService.listByUser(user.id, limit, offset);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      clientId: r.clientId ?? undefined,
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse,
      status: r.status,
      measuredAt: r.measuredAt,
      imageUri: r.imageUri ?? undefined,
      notes: r.notes ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  @Mutation(() => ReadingType, { description: 'บันทึกค่าความดันโลหิต' })
  @UseGuards(GqlAuthGuard)
  async createReading(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateReadingInput,
  ): Promise<ReadingType> {
    const r = await this.readingService.create(user.id, input);
    return {
      id: r.id,
      userId: r.userId,
      clientId: r.clientId ?? undefined,
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse,
      status: r.status,
      measuredAt: r.measuredAt,
      imageUri: r.imageUri ?? undefined,
      notes: r.notes ?? undefined,
      createdAt: r.createdAt,
    };
  }

  @Mutation(() => Boolean, { description: 'ลบค่าความดัน' })
  @UseGuards(GqlAuthGuard)
  async deleteReading(
    @CurrentUser() user: { id: string },
    @Args('id', { type: () => Int }) id: number,
  ): Promise<boolean> {
    const result = await this.readingService.delete(user.id, id);
    return result !== null;
  }
}
