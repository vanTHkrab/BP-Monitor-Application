import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import { AnalyzeBPImageInput } from './dto/analyze-bp-image.input';
import { AnalysisJobObject } from './dto/analysis-job.object';
import { BPReadingRecordObject } from './dto/bp-reading-record.object';
import { SubmitBPReadingInput } from './dto/submit-bp-reading.input';

@Resolver()
@UseGuards(GqlAuthGuard)
export class AiResolver {
  constructor(private readonly aiService: AiService) {}

  @Mutation(() => AnalysisJobObject, {
    description:
      'จัดคิวให้ AI วิเคราะห์รูป BP ที่อัปขึ้น S3 แล้ว (presigned flow)',
  })
  async analyzeBPImage(
    @Args('input') input: AnalyzeBPImageInput,
    @CurrentUser() user: { id: string },
  ): Promise<AnalysisJobObject> {
    return this.aiService.enqueueFromKey(
      input.s3Key,
      input.mimeType,
      user.id,
      input.ocrEngine,
    );
  }

  @Query(() => AnalysisJobObject)
  async analysisJob(
    @Args('jobId') jobId: string,
    @CurrentUser() user: { id: string },
  ): Promise<AnalysisJobObject> {
    return this.aiService.getJobState(jobId, user.id);
  }

  @Mutation(() => BPReadingRecordObject)
  async submitBPReading(
    @Args('input') input: SubmitBPReadingInput,
    @CurrentUser() user: { id: string },
  ): Promise<BPReadingRecordObject> {
    const reading = await this.aiService.submitReading(input, user.id);
    return {
      id: String(reading.id),
      systolic: reading.systolic,
      diastolic: reading.diastolic,
      pulse: reading.pulse,
      measuredAt: reading.measuredAt.toISOString(),
      s3Key: reading.s3Key ?? null,
    };
  }
}
