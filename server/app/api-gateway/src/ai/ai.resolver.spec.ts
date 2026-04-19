/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../auth/auth.guard', () => ({
  GqlAuthGuard: class GqlAuthGuard {},
}));

jest.mock('./ai.service', () => ({
  AiService: class AiService {},
}));

import { AiResolver } from './ai.resolver';
import { AiService } from './ai.service';

describe('AiResolver', () => {
  let resolver: AiResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiResolver,
        {
          provide: AiService,
          useValue: {
            enqueueImageAnalysis: jest.fn(),
            getJobState: jest.fn(),
            submitReading: jest.fn(),
          },
        },
      ],
    }).compile();

    resolver = module.get<AiResolver>(AiResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
