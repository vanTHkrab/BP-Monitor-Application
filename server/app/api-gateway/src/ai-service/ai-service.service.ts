import { Inject, Injectable } from '@nestjs/common';
import UUID from 'crypto';
import Redis from 'ioredis';
import { BpAnalysisResult } from './bp-result.type';

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const isBpAnalysisResult = (value: unknown): value is BpAnalysisResult => {
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

@Injectable()
export class AiServiceService {
  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  async analyzeImage(imageData: string): Promise<BpAnalysisResult> {
    // Create a unique job ID for this analysis task
    const jobId = UUID.randomUUID();

    // Prepare the payload to send to the AI Service
    const payload = {
      id: jobId,
      data: imageData,
    };

    // Publish the job to the Redis channel that the AI Service is subscribed to
    await this.redisClient.publish('analyze_bp_image', JSON.stringify(payload));
    console.log(
      `Published job with ID: ${jobId} to Redis channel 'analyze_bp_image'`,
    );

    // Wait for the AI Service to process the image and publish the results back to a reply channel
    return new Promise((resolve, reject) => {
      const replyChannel = `reply_${jobId}`;

      const handleMessage = (message: string) => {
        try {
          const parsed: unknown = JSON.parse(message);

          if (!isBpAnalysisResult(parsed)) {
            reject(new Error('Invalid analyze image response payload'));
            return;
          }

          const response = parsed;
          if (response.id === jobId) {
            this.redisClient.removeListener('message', onMessage);
            void this.redisClient.unsubscribe(replyChannel);
            resolve(response);
          }
        } catch (error) {
          reject(toError(error));
        }
      };

      const onMessage = (channel: string, message: string) => {
        if (channel === replyChannel) {
          handleMessage(message);
        }
      };

      this.redisClient.on('message', onMessage);
      void this.redisClient.subscribe(replyChannel).catch((error: unknown) => {
        this.redisClient.removeListener('message', onMessage);
        reject(toError(error));
      });
    });
  }
}
