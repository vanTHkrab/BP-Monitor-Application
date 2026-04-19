/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import GraphQLUpload from 'graphql-upload/GraphQLUpload.mjs';
import type { FileUpload } from 'graphql-upload/processRequest.mjs';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import { AnalysisJobObject } from './dto/analysis-job.object';
import { BPReadingRecordObject } from './dto/bp-reading-record.object';
import { SubmitBPReadingInput } from './dto/submit-bp-reading.input';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

@Resolver()
@UseGuards(GqlAuthGuard)
export class AiResolver {
  constructor(private readonly aiService: AiService) {}

  @Mutation(() => AnalysisJobObject)
  async uploadBPImage(
    @Args({ name: 'file', type: () => GraphQLUpload })
    upload: Promise<FileUpload>,
    @CurrentUser() user: { id: string },
  ): Promise<AnalysisJobObject> {
    const { createReadStream, mimetype, filename } = await upload;

    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimetype)) {
      throw new BadRequestException('Unsupported image type');
    }

    // Buffering with a hard cap prevents oversized uploads from exhausting memory.
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      createReadStream()
        .on('data', (chunk: Buffer | string) => {
          const normalizedChunk = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk);
          totalBytes += normalizedChunk.length;

          if (totalBytes > MAX_UPLOAD_BYTES) {
            reject(new BadRequestException('Image file is too large'));
            return;
          }

          chunks.push(normalizedChunk);
        })
        .on('end', () => resolve(Buffer.concat(chunks)))
        .on('error', reject);
    });

    return this.aiService.enqueueImageAnalysis(
      { buffer, mimetype, originalname: filename },
      user.id,
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
      imageUrl: reading.imageUri ?? null,
    };
  }
}
