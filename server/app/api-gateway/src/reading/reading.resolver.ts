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
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BpStatus } from '../prisma/generated/enums';
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
  // Every field needs a class-validator decorator alongside @Field — the
  // global ValidationPipe runs with `whitelist: true` + `forbidNonWhitelisted: true`
  // and strips / 400s any property the validator doesn't know about.
  @Field(() => Int)
  @IsInt()
  systolic: number;

  @Field(() => Int)
  @IsInt()
  diastolic: number;

  @Field(() => Int)
  @IsInt()
  pulse: number;

  @Field()
  @IsEnum(BpStatus)
  status: string;

  @Field()
  @IsDate()
  measuredAt: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientId?: string;

  // Image row id returned by confirmImageUpload. When present, the new
  // reading is attached to that Image (Image.readingId is set). Omit for
  // manual entries with no captured image.
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  imageId?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
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
    const r = await this.readingService.create(user.id, input);
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
    notes: string | null;
    createdAt: Date;
    images: { s3Key: string }[];
  }): Promise<ReadingType> {
    // 1:0..1 today (Image.readingId @unique), so the first row is the
    // only row. If we later relax to multi-image, return the array and
    // pick a primary at the GraphQL field level.
    const rawS3Key = r.images[0]?.s3Key ?? null;
    const signedS3Key = await this.storage.signImageKey(rawS3Key);
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
