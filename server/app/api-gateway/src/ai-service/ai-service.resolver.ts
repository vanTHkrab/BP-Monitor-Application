import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AnalyzeImageInput } from './ai-service.input';
import { AiServiceService } from './ai-service.service';
import { BpAnalysisResult } from './bp-result.type';

@Resolver()
export class AiServiceResolver {
  constructor(private readonly aiServiceService: AiServiceService) {}

  @Mutation(() => BpAnalysisResult, { description: 'วิเคราะห์ภาพความดันโลหิต' })
  async analyzeImage(
    @Args('input') input: AnalyzeImageInput,
  ): Promise<BpAnalysisResult> {
    const { imageData } = input;
    const result = await this.aiServiceService.analyzeImage(imageData);
    return result;
  }
}
