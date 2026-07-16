import { UseGuards } from '@nestjs/common';
import {
  Args,
  Field,
  ID,
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
  IsUUID,
  MaxLength,
} from 'class-validator';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CaregiverService } from '../caregiver/caregiver.service';
import { BpStatus } from '../prisma/generated/enums';
import { StorageService } from '../storage/storage.service';
import { ReadingService } from './reading.service';

@ObjectType({
  description:
    'ผู้ที่บันทึกค่าความดันแทนเจ้าของข้อมูล (เช่น caregiver) — null เมื่อผู้ป่วยบันทึกเอง',
})
export class ReadingRecordedByType {
  @Field(() => ID) id: string;
  @Field() firstname: string;
  @Field() lastname: string;
}

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
  // NULL = the patient entered the reading themselves (self-entries carry
  // no attribution row); non-null = the user who recorded it on their behalf.
  @Field(() => ReadingRecordedByType, { nullable: true })
  recordedBy?: ReadingRecordedByType;
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

  // Caregiver mode: create the reading on behalf of this patient. Requires
  // an accepted CaregiverPatient link — the same rule the readings(patientId:)
  // query enforces. Omit (or send your own id) to create for yourself.
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  patientId?: string;
}

@Resolver()
export class ReadingResolver {
  constructor(
    private readonly readingService: ReadingService,
    private readonly storage: StorageService,
    private readonly caregiverService: CaregiverService,
  ) {}

  @Query(() => [ReadingType], {
    description:
      'รายการค่าความดันของผู้ใช้ (caregiver ระบุ patientId เพื่อดูข้อมูลผู้ป่วยที่ดูแล)',
  })
  @UseGuards(GqlAuthGuard)
  async readings(
    @CurrentUser() user: { id: string },
    @Args('limit', { type: () => Int, defaultValue: 200 }) limit: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
    @Args('patientId', { type: () => ID, nullable: true }) patientId?: string,
  ): Promise<ReadingType[]> {
    const targetUserId = patientId ?? user.id;
    if (targetUserId !== user.id) {
      await this.caregiverService.assertCanActOnBehalfOf(user.id, targetUserId);
    }
    const rows = await this.readingService.listByUser(
      targetUserId,
      limit,
      offset,
    );
    return Promise.all(rows.map((r) => this.toReadingType(r)));
  }

  @Mutation(() => ReadingType, {
    description:
      'บันทึกค่าความดันโลหิต (caregiver ระบุ patientId เพื่อบันทึกแทนผู้ป่วยที่ดูแล)',
  })
  @UseGuards(GqlAuthGuard)
  async createReading(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateReadingInput,
  ): Promise<ReadingType> {
    // Same authorization gate as the readings(patientId:) query above —
    // writing on behalf of a patient requires an accepted caregiver link.
    const targetUserId = input.patientId ?? user.id;
    if (targetUserId !== user.id) {
      await this.caregiverService.assertCanActOnBehalfOf(user.id, targetUserId);
    }
    const r = await this.readingService.create(targetUserId, input, user.id);
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
    recordedBy: { id: string; firstname: string; lastname: string } | null;
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
      recordedBy: r.recordedBy ?? undefined,
    };
  }
}
