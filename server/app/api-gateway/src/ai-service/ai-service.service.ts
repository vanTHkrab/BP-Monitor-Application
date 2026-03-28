import {
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { BpAnalysisResult } from './ai-service.result';

const ANALYZE_CHANNEL = 'analyze_bp_image';
const DEFAULT_ANALYSIS_TIMEOUT_MS = 15000;

type AnalyzeImagePayload = {
  id: string;
  data: string;
};

type WorkerBpAnalysisResponse = {
  id: string;
  systolic: number;
  diastolic: number;
  heartRate: number;
  confidence?: number;
};

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const isWorkerBpAnalysisResponse = (
  value: unknown,
): value is WorkerBpAnalysisResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const response = value as Record<string, unknown>;

  return (
    typeof response.id === 'string' &&
    typeof response.systolic === 'number' &&
    typeof response.diastolic === 'number' &&
    typeof response.heartRate === 'number'
  );
};

const mapToBpAnalysisResult = (
  response: WorkerBpAnalysisResponse,
): BpAnalysisResult => ({
  id: response.id,
  systolic: response.systolic,
  diastolic: response.diastolic,
  pulse: response.heartRate,
  confidence: response.confidence,
});

const getAnalysisTimeoutMs = (): number => {
  const rawTimeout = process.env.AI_ANALYSIS_TIMEOUT_MS;
  if (!rawTimeout) {
    return DEFAULT_ANALYSIS_TIMEOUT_MS;
  }

  const parsedTimeout = Number(rawTimeout);
  if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
    return DEFAULT_ANALYSIS_TIMEOUT_MS;
  }

  return Math.floor(parsedTimeout);
};

@Injectable()
export class AiServiceService {
  private readonly logger = new Logger(AiServiceService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  async analyzeImage(imageData: string): Promise<BpAnalysisResult> {
    const jobId = randomUUID();
    const replyChannel = `reply_${jobId}`;
    const timeoutMs = getAnalysisTimeoutMs();
    const payload: AnalyzeImagePayload = {
      id: jobId,
      data: imageData,
    };

    const subscriberClient = this.redisClient.duplicate();

    try {
      await subscriberClient.subscribe(replyChannel);
      await this.redisClient.publish(ANALYZE_CHANNEL, JSON.stringify(payload));

      this.logger.debug(
        `Published analysis job ${jobId} to channel ${ANALYZE_CHANNEL}`,
      );

      return await new Promise<BpAnalysisResult>((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;
          subscriberClient.removeListener('message', onMessage);
          reject(
            new GatewayTimeoutException(
              `Timed out waiting for AI analysis response for job ${jobId}`,
            ),
          );
        }, timeoutMs);

        const onMessage = (channel: string, message: string) => {
          if (channel !== replyChannel || settled) {
            return;
          }

          settled = true;
          clearTimeout(timeoutId);
          subscriberClient.removeListener('message', onMessage);

          try {
            const parsed: unknown = JSON.parse(message);

            if (!isWorkerBpAnalysisResponse(parsed)) {
              reject(new Error('Invalid analyze image response payload'));
              return;
            }

            if (parsed.id !== jobId) {
              reject(
                new Error(`Mismatched job ID in AI response: ${parsed.id}`),
              );
              return;
            }

            resolve(mapToBpAnalysisResult(parsed));
          } catch (error) {
            reject(toError(error));
          }
        };

        subscriberClient.on('message', onMessage);
      });
    } catch (error) {
      this.logger.error(
        `Failed to process AI analysis request for job ${jobId}`,
        toError(error).stack,
      );

      throw new ServiceUnavailableException(
        'AI analysis service is temporarily unavailable',
      );
    } finally {
      subscriberClient.removeAllListeners('message');
      void subscriberClient.unsubscribe(replyChannel).catch(() => undefined);
      void subscriberClient.quit().catch(() => undefined);
    }
  }
}
