import { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";

export type StorageProvider = 'cloudflare' | 'aws' | 'minio' | 'digitalocean';

// Declare a global variable to store the instance during development 
// (prevents Next.js HMR from creating multiple instances)
declare global {
    var _s3ClientInstance: StorageService | undefined;
}

class StorageService {
    private client: S3Client;
    public readonly bucketName: string;

    constructor() {
        this.bucketName = this.requireEnv('S3_BUCKET_NAME');
        const provider = (process.env.S3_PROVIDER as StorageProvider) || 'cloudflare';

        this.client = this.createClient(provider);
    }

    /**
     * Helper to enforce required environment variables. 
     * Throws an error immediately if missing (Fail-Fast approach).
     */
    private requireEnv(key: string): string {
        const value = process.env[key];
        if (!value) {
            throw new Error(`[StorageService] Critical Error: Missing required environment variable '${key}'`);
        }
        return value;
    }

    /**
     * Factory Method to create an S3 Client based on the provider's specific requirements.
     */
    private createClient(provider: StorageProvider): S3Client {
        const accessKeyId = this.requireEnv('S3_ACCESS_KEY_ID');
        const secretAccessKey = this.requireEnv('S3_SECRET_ACCESS_KEY');
        
        // AWS typically uses a specific region, Cloudflare R2 often uses 'auto'
        const region = process.env.S3_REGION || 'auto'; 
        const endpoint = process.env.S3_ENDPOINT; 

        // Base configuration required by all providers
        const baseConfig: S3ClientConfig = {
            region,
            credentials: { accessKeyId, secretAccessKey },
        };

        switch (provider) {
            case 'cloudflare':
                if (!endpoint) throw new Error('[StorageService] S3_ENDPOINT is required for Cloudflare R2');
                return new S3Client({
                    ...baseConfig,
                    endpoint,
                });

            case 'aws':
                // AWS usually doesn't need a custom endpoint, just the region is sufficient
                return new S3Client(baseConfig); 

            case 'minio':
                if (!endpoint) throw new Error('[StorageService] S3_ENDPOINT is required for MinIO');
                return new S3Client({
                    ...baseConfig,
                    endpoint,
                    // Crucial for MinIO or local storage emulators
                    forcePathStyle: true, 
                });

            case 'digitalocean':
                 if (!endpoint) throw new Error('[StorageService] S3_ENDPOINT is required for DigitalOcean Spaces');
                 return new S3Client({
                     ...baseConfig,
                     endpoint,
                 });

            default:
                throw new Error(`[StorageService] Unsupported S3 provider: ${provider}`);
        }
    }

    /**
     * Exposes the S3 Client for usage.
     */
    public getClient(): S3Client {
        return this.client;
    }
}

// Singleton Export for Next.js
export const storageService = global._s3ClientInstance || new StorageService();

if (process.env.NODE_ENV !== 'production') {
    global._s3ClientInstance = storageService;
}

// Export the Client and BucketName directly for convenient importing
export const s3Client = storageService.getClient();
export const bucketName = storageService.bucketName;