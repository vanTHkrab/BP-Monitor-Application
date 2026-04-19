import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import GraphQLUpload from 'graphql-upload/GraphQLUpload.js';
import type { FileUpload } from 'graphql-upload/processRequest.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { AnalysisJobObject } from './dto/analysis-job.object';
import { BPReadingRecordObject } from './dto/bp-reading-record.object';
import { SubmitBPReadingInput } from './dto/submit-bp-reading.input';

@Resolver()
@UseGuards(JwtAuthGuard)
export class AiResolver {
  constructor(private readonly aiService: AiService) {}

  // ─── Upload image → enqueue → return initial job ──────────────────────────

  @Mutation(() => AnalysisJobObject)
  async uploadBPImage(
    @Args({ name: 'file', type: () => GraphQLUpload }) upload: Promise<FileUpload>,
    @CurrentUser() user: { id: string },
  ): Promise<AnalysisJobObject> {
    const { createReadStream, mimetype, filename } = await upload;

    // Stream → Buffer
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      createReadStream()
        .on('data', (chunk: Buffer) => chunks.push(chunk))
        .on('end', () => resolve(Buffer.concat(chunks)))
        .on('error', reject);
    });

    return this.aiService.enqueueImageAnalysis(
      { buffer, mimetype, originalname: filename },
      user.id,
    );
  }

  // ─── Poll job status ───────────────────────────────────────────────────────

  @Query(() => AnalysisJobObject)
  async analysisJob(
    @Args('jobId') jobId: string,
    @CurrentUser() user: { id: string },
  ): Promise<AnalysisJobObject> {
    return this.aiService.getJobState(jobId);
  }

  // ─── Persist confirmed reading ─────────────────────────────────────────────

  @Mutation(() => BPReadingRecordObject)
  async submitBPReading(
    @Args('input') input: SubmitBPReadingInput,
    @CurrentUser() user: { id: string },
  ): Promise<BPReadingRecordObject> {
    const reading = await this.aiService.submitReading(input, user.id);
    return {
      id: reading.id,
      systolic: reading.systolic,
      diastolic: reading.diastolic,
      pulse: reading.pulse,
      measuredAt: reading.measuredAt.toISOString(),
      imageUrl: reading.imageUrl ?? null,
    };
  }
}
