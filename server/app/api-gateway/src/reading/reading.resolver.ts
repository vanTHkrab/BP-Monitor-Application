import { UseGuards } from '@nestjs/common';
import {
  Args,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { StorageService } from '../storage/storage.service';
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
  @Field({ nullable: true }) s3Key?: string;
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
  @Field({ nullable: true }) s3Key?: string;
  @Field({ nullable: true }) notes?: string;
}

@Resolver()
export class ReadingResolver {
  constructor(
    private readonly readingService: ReadingService,
    private readonly storage: StorageService,
  ) {}

  @Query(() => [ReadingType], { description: 'รายการค่าความดันของผู้ใช้' })
  @UseGuards(GqlAuthGuard)
  async readings(
    @CurrentUser() user: { id: string },
    @Args('limit', { type: () => Int, defaultValue: 200 }) limit: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
  ): Promise<ReadingType[]> {
    const rows = await this.readingService.listByUser(user.id, limit, offset);
    return Promise.all(rows.map((r) => this.toReadingType(r)));
  }

  @Mutation(() => ReadingType, { description: 'บันทึกค่าความดันโลหิต' })
  @UseGuards(GqlAuthGuard)
  async createReading(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateReadingInput,
  ): Promise<ReadingType> {
    const r = await this.readingService.create(user.id, {
      ...input,
      s3Key: this.storage.normalizeStorageValue(input.s3Key) ?? undefined,
    });
    return this.toReadingType(r);
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

  private async toReadingType(r: {
    id: number;
    userId: string;
    clientId: string | null;
    systolic: number;
    diastolic: number;
    pulse: number;
    status: string;
    measuredAt: Date;
    s3Key: string | null;
    notes: string | null;
    createdAt: Date;
  }): Promise<ReadingType> {
    const signedS3Key = await this.storage.signImageKey(r.s3Key);
    return {
      id: r.id,
      userId: r.userId,
      clientId: r.clientId ?? undefined,
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse,
      status: r.status,
      measuredAt: r.measuredAt,
      s3Key: signedS3Key ?? undefined,
      notes: r.notes ?? undefined,
      createdAt: r.createdAt,
    };
  }
}
