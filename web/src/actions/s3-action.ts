'use server'

import type { StorageProvider } from "@/lib/s3"
import { storageService } from "@/lib/s3"
import {
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

interface S3ActionResult {
    success: boolean;
    message?: string;
}

export interface S3ConnectionResult extends S3ActionResult {
    data?: {
        bucketName: string;
        provider: StorageProvider;
        region: string;
        endpoint?: string;
    };
}

export interface S3File {
    key: string;
    size: number;
    lastModified: string;
    eTag?: string;
    storageClass?: string;
}

export interface ListFilesParams {
    prefix?: string;
    maxKeys?: number;
    continuationToken?: string;
}

export interface ListFilesResult extends S3ActionResult {
    files?: S3File[];
    keyCount?: number;
    isTruncated?: boolean;
    nextContinuationToken?: string;
}

export interface SignedUrlResult extends S3ActionResult {
    url?: string;
    expiresInSeconds?: number;
    expiresAt?: string;
}

export interface CreateUploadUrlParams {
    fileName: string;
    contentType?: string;
    prefix?: string;
    expiresInSeconds?: number;
}

export interface CreateUploadUrlResult extends S3ActionResult {
    data?: {
        key: string;
        url: string;
        expiresInSeconds: number;
        expiresAt: string;
    };
}

export interface BulkDeleteResult extends S3ActionResult {
    deletedKeys: string[];
    failedKeys: string[];
}

function normalizePrefix(prefix?: string): string {
    const value = (prefix || "uploads/").trim();
    const withoutLeadingSlash = value.replace(/^\/+/, "");
    const withoutTrailingSlash = withoutLeadingSlash.replace(/\/+$/, "");

    return `${withoutTrailingSlash}/`;
}

function sanitizeFileName(fileName: string): string {
    return fileName
        .trim()
        .replace(/[\\/]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9._-]/g, "-");
}

function toErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallback;
}

/**
 * Check S3 Connection
 * @returns { success: boolean, message?: string }
 */
export async function getConnection(): Promise<S3ConnectionResult> {
    try {
        const s3Client = storageService.getClient();
        await s3Client.send(new ListObjectsV2Command({ Bucket: storageService.bucketName, MaxKeys: 1 }));

        const provider = (process.env.S3_PROVIDER as StorageProvider) || 'cloudflare';

        return {
            success: true,
            data: {
                bucketName: storageService.bucketName,
                provider,
                region: process.env.S3_REGION || 'auto',
                endpoint: process.env.S3_ENDPOINT,
            },
        };
    } catch (error) {
        console.error('[Action] S3 Connection Error:', error);
        return {
            success: false,
            message: toErrorMessage(error, 'Failed to connect to S3. Please check your configuration.'),
        };
    }
}

/**
 * Upload File to S3
 * @param formData 
 * @returns { success: boolean, message?: string }
 */
export async function uploadFileToS3(formData: FormData): Promise<S3ActionResult & { data?: { key: string } }> {
    try {
        const file = formData.get('file') as File | null;
        
        if (!file) {
            return { success: false, message: 'No file provided.' };
        }

        const s3Client = storageService.getClient();
        const bucketName = storageService.bucketName;

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const safeName = file.name.replace(/\s+/g, '-');
        const fileKey = `uploads/${Date.now()}-${safeName}`;

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: fileKey,
            Body: buffer,
            ContentType: file.type,
        });

        await s3Client.send(command);

        return { 
            success: true, 
            message: 'File uploaded successfully.',
            data: { key: fileKey }
        };
    } catch (error) {
        console.error('[Action] Error uploading file to S3:', error);
        return {
            success: false,
            message: toErrorMessage(error, 'Failed to upload file. Please try again.'),
        };
    }
}

/**
 * Generate a pre-signed URL for direct upload from browser (supports upload progress).
 */
export async function createUploadUrl(params: CreateUploadUrlParams): Promise<CreateUploadUrlResult> {
    try {
        if (!params.fileName || params.fileName.trim().length === 0) {
            return { success: false, message: 'File name is required.' };
        }

        const s3Client = storageService.getClient();
        const expiresInSeconds = Math.min(Math.max(params.expiresInSeconds ?? 600, 60), 3600);
        const normalizedPrefix = normalizePrefix(params.prefix);
        const safeFileName = sanitizeFileName(params.fileName);
        const objectKey = `${normalizedPrefix}${Date.now()}-${crypto.randomUUID()}-${safeFileName}`;
        const contentType = params.contentType || 'application/octet-stream';

        const command = new PutObjectCommand({
            Bucket: storageService.bucketName,
            Key: objectKey,
            ContentType: contentType,
        });

        const url = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });

        return {
            success: true,
            data: {
                key: objectKey,
                url,
                expiresInSeconds,
                expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
            },
        };
    } catch (error) {
        console.error('[Action] Error creating upload URL:', error);
        return {
            success: false,
            message: toErrorMessage(error, 'Failed to create upload URL.'),
        };
    }
}

/**
 * List Files in S3 Bucket
 * @param params 
 * @returns { success: boolean, message?: string, files?: Array<{ key: string, size: number, lastModified: Date }> }
 */
export async function listFiles(params: ListFilesParams = {}): Promise<ListFilesResult> {
    try {
        const prefix = params.prefix || '';
        const maxKeys = Math.min(Math.max(params.maxKeys ?? 1000, 1), 1000);
        const s3Client = storageService.getClient();

        const command = new ListObjectsV2Command({
            Bucket: storageService.bucketName,
            Prefix: prefix,
            MaxKeys: maxKeys,
            ContinuationToken: params.continuationToken,
        });

        const response = await s3Client.send(command);

        const files: S3File[] = (response.Contents || [])
            .filter(item => item.Key !== undefined) 
            .map(item => ({
                key: item.Key!,
                size: item.Size ?? 0,
                lastModified: (item.LastModified ?? new Date(0)).toISOString(),
                eTag: item.ETag,
                storageClass: item.StorageClass,
            }));

        return {
            success: true,
            files,
            keyCount: response.KeyCount,
            isTruncated: response.IsTruncated,
            nextContinuationToken: response.NextContinuationToken,
        };
    } catch (error) {
        console.error('[Action] Error listing files:', error);
        return {
            success: false,
            message: toErrorMessage(error, 'Failed to list files.'),
        };
    }
}

/**
 * Generate a Pre-signed URL for a file in S3
 * @param fileKey 
 * @returns { success: boolean, url?: string, message?: string }
 */
export async function getFileUrl(fileKey: string, expiresInSeconds = 3600): Promise<SignedUrlResult> {
    try {
        const s3Client = storageService.getClient();
        const command = new GetObjectCommand({
            Bucket: storageService.bucketName,
            Key: fileKey,
        });

        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });

        return {
            success: true,
            url: signedUrl,
            expiresInSeconds,
            expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
        };
    } catch (error) {
        console.error('[Action] Error generating signed URL:', error);
        return {
            success: false,
            message: toErrorMessage(error, 'Failed to generate file URL.'),
        };
    }
}

/**
 * Delete a file from S3
 * @param fileKey 
 * @returns { success: boolean, message?: string }
 */
export async function deleteFileFromS3(fileKey: string): Promise<S3ActionResult> {
    try {
        const s3Client = storageService.getClient();
        const command = new DeleteObjectCommand({
            Bucket: storageService.bucketName,
            Key: fileKey,
        });

        await s3Client.send(command);

        return { success: true, message: 'File deleted successfully.' };
    } catch (error) {
        console.error('[Action] Error deleting file:', error);
        return {
            success: false,
            message: toErrorMessage(error, 'Failed to delete file.'),
        };
    }
}

/**
 * Delete multiple files in S3 (supports up to 1000 keys per request).
 */
export async function deleteFilesFromS3(fileKeys: string[]): Promise<BulkDeleteResult> {
    if (!Array.isArray(fileKeys) || fileKeys.length === 0) {
        return {
            success: false,
            message: 'No file keys provided.',
            deletedKeys: [],
            failedKeys: [],
        };
    }

    const s3Client = storageService.getClient();
    const bucketName = storageService.bucketName;
    const deletedKeys: string[] = [];
    const failedKeys: string[] = [];

    const uniqueKeys = [...new Set(fileKeys.filter(Boolean))];

    for (let index = 0; index < uniqueKeys.length; index += 1000) {
        const chunk = uniqueKeys.slice(index, index + 1000);

        try {
            const response = await s3Client.send(
                new DeleteObjectsCommand({
                    Bucket: bucketName,
                    Delete: {
                        Objects: chunk.map((key) => ({ Key: key })),
                        Quiet: false,
                    },
                })
            );

            for (const item of response.Deleted ?? []) {
                if (item.Key) {
                    deletedKeys.push(item.Key);
                }
            }

            for (const item of response.Errors ?? []) {
                if (item.Key) {
                    failedKeys.push(item.Key);
                }
            }
        } catch (error) {
            console.error('[Action] Error deleting a chunk of files:', error);
            failedKeys.push(...chunk);
        }
    }

    const success = failedKeys.length === 0;

    return {
        success,
        message: success
            ? `Deleted ${deletedKeys.length} file(s).`
            : `Deleted ${deletedKeys.length} file(s), failed to delete ${failedKeys.length} file(s).`,
        deletedKeys,
        failedKeys,
    };
}