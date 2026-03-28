import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AnalyzeImageInput } from './ai-service.input';
import { BpAnalysisResult } from './ai-service.result';
import { AiServiceService } from './ai-service.service';
import { AIJob } from './ai-service.type';

@Resolver(() => AIJob)
export class AiServiceResolver {
  constructor(private readonly aiServiceService: AiServiceService) {}

  @Mutation(() => BpAnalysisResult, { description: 'วิเคราะห์ภาพความดันโลหิต' })
  async analyzeImage(
    @Args('input') input: AnalyzeImageInput,
  ): Promise<BpAnalysisResult> {
    return this.aiServiceService.analyzeImage(input.imageData);
  }
}
