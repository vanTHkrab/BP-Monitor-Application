import { Test, TestingModule } from '@nestjs/testing';
import { AiServiceResolver } from './ai-service.resolver';

describe('AiServiceResolver', () => {
  let resolver: AiServiceResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiServiceResolver],
    }).compile();

    resolver = module.get<AiServiceResolver>(AiServiceResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
