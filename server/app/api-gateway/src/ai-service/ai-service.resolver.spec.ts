import { Test, TestingModule } from '@nestjs/testing';
import { AiServiceResolver } from './ai-service.resolver';
import { AiServiceService } from './ai-service.service';

describe('AiServiceResolver', () => {
  let resolver: AiServiceResolver;
  let aiService: { analyzeImage: jest.Mock };

  beforeEach(async () => {
    aiService = {
      analyzeImage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiServiceResolver,
        {
          provide: AiServiceService,
          useValue: aiService,
        },
      ],
    }).compile();

    resolver = module.get<AiServiceResolver>(AiServiceResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });

  it('should forward image data to service and return result', async () => {
    const expected = {
      id: 'job-1',
      systolic: 118,
      diastolic: 76,
      pulse: 69,
    };

    aiService.analyzeImage.mockResolvedValue(expected);

    await expect(
      resolver.analyzeImage({ imageData: 'base64-image' }),
    ).resolves.toEqual(expected);
    expect(aiService.analyzeImage).toHaveBeenCalledWith('base64-image');
  });
});
