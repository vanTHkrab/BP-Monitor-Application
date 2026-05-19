import { graphqlRequest } from "@/src/core/graphql/client";
import {
    GQL_CONFIRM_IMAGE_UPLOAD,
    GQL_REQUEST_IMAGE_UPLOAD,
} from "@/src/core/graphql/operations";
import { File } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

export type UploadImageKind = "profile" | "blood-pressure";

// GraphQL ImageKind enum values on the server.
const SERVER_IMAGE_KIND: Record<UploadImageKind, string> = {
  profile: "PROFILE",
  "blood-pressure": "BLOOD_PRESSURE_READING",
};

interface PresignedUploadResponse {
  uploadUrl: string;
  key: string;
  headers: { name: string; value: string }[];
  expiresAt: string;
}

interface ConfirmedImageResponse {
  key: string;
  url: string;
  imageId?: number;
}

const getMimeTypeFromUri = (uri: string) => {
  const lower = uri.split("?")[0].toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
};

export const isRemoteImageUri = (uri?: string | null) =>
  Boolean(uri && /^https?:\/\//i.test(uri));

// Thrown when the local file URI can't be read — typically because the
// device cache that held the captured image was evicted between save and
// sync. Callers (e.g. the offline-queue sync) use this to drop the image
// and proceed with the rest of the record instead of retrying forever.
export class LocalImageMissingError extends Error {
  readonly uri: string;
  constructor(uri: string) {
    super(`Local image not readable: ${uri}`);
    this.name = "LocalImageMissingError";
    this.uri = uri;
  }
}

/**
 * Upload an image directly to S3 via a presigned URL.
 *
 * Flow: gateway issues a presigned PUT URL → mobile uploads binary
 * straight to S3 → gateway verifies and records the object.
 *
 * The image never passes through the gateway, so gateway memory
 * pressure + base64 overhead are both gone.
 *
 * Returns the canonical URL stored on the server.
 */
export const uploadImageViaPresign = async ({
  uri,
  kind,
  token,
}: {
  uri: string;
  kind: UploadImageKind;
  token: string;
}): Promise<string> => {
  if (isRemoteImageUri(uri)) {
    console.log(`[S3 presign] skip remote image kind=${kind} uri=${uri}`);
    return uri;
  }

  const mimeType = getMimeTypeFromUri(uri);
  const serverKind = SERVER_IMAGE_KIND[kind];

  // On native we hand the file URI to FileSystem.uploadAsync so the binary
  // streams from disk straight to S3 — RN's Blob does not accept ArrayBuffer
  // inputs, so the browser-style fetch+Blob path is web-only.
  const isWeb = Platform.OS === "web";

  let size: number;
  let webBytes: Uint8Array | null = null;
  try {
    if (isWeb) {
      webBytes = await new File(uri).bytes();
      size = webBytes.byteLength;
    } else {
      // `File#size` returns `number | null` — null when the path can't be
      // stat'd (file evicted, never existed, sandbox path stale).
      const native = new File(uri).size;
      if (native == null) throw new LocalImageMissingError(uri);
      size = native;
    }
  } catch (error) {
    if (error instanceof LocalImageMissingError) throw error;
    console.warn(`[S3 presign] file-read-failed kind=${kind} uri=${uri}`, error);
    throw new LocalImageMissingError(uri);
  }

  if (!Number.isFinite(size) || size <= 0) {
    console.warn(`[S3 presign] file-empty kind=${kind} uri=${uri} size=${size}`);
    throw new LocalImageMissingError(uri);
  }

  console.log(
    `[S3 presign] start kind=${kind} mimeType=${mimeType} size=${size}B`,
  );

  // 1. Request a presigned URL.
  let presign: PresignedUploadResponse;
  try {
    const data = await graphqlRequest<{
      requestImageUpload: PresignedUploadResponse;
    }>(
      GQL_REQUEST_IMAGE_UPLOAD,
      { input: { kind: serverKind, mimeType, size } },
      token,
    );
    presign = data.requestImageUpload;
  } catch (error) {
    console.error(`[S3 presign] request-failed kind=${kind}`, error);
    throw error;
  }

  // 2. PUT the binary body straight to S3.
  const headers: Record<string, string> = {};
  for (const h of presign.headers) headers[h.name] = h.value;

  let putStatus: number;
  let putBody = "";
  try {
    if (isWeb) {
      // Cast: expo-file-system returns Uint8Array<ArrayBuffer>, but TS widens
      // the generic at the call site so BlobPart's strict typing rejects it.
      const body = new Blob([webBytes as Uint8Array<ArrayBuffer>], {
        type: mimeType,
      });
      const res = await fetch(presign.uploadUrl, { method: "PUT", headers, body });
      putStatus = res.status;
      if (!res.ok) putBody = await res.text().catch(() => "");
    } else {
      const result = await LegacyFileSystem.uploadAsync(presign.uploadUrl, uri, {
        httpMethod: "PUT",
        headers,
        uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      putStatus = result.status;
      if (result.status < 200 || result.status >= 300) {
        putBody = result.body ?? "";
      }
    }
  } catch (error) {
    console.error(`[S3 presign] put-failed kind=${kind} key=${presign.key}`, error);
    throw error;
  }
  if (putStatus < 200 || putStatus >= 300) {
    console.error(
      `[S3 presign] put-rejected kind=${kind} key=${presign.key} status=${putStatus} body=${putBody.slice(0, 200)}`,
    );
    throw new Error(`S3 upload rejected (${putStatus})`);
  }

  // 3. Confirm — server verifies the object and persists records as needed.
  let confirmed: ConfirmedImageResponse;
  try {
    const data = await graphqlRequest<{
      confirmImageUpload: ConfirmedImageResponse;
    }>(
      GQL_CONFIRM_IMAGE_UPLOAD,
      { input: { kind: serverKind, key: presign.key } },
      token,
    );
    confirmed = data.confirmImageUpload;
  } catch (error) {
    console.error(
      `[S3 presign] confirm-failed kind=${kind} key=${presign.key}`,
      error,
    );
    throw error;
  }

  console.log(
    `[S3 presign] success kind=${kind} key=${confirmed.key} imageId=${confirmed.imageId ?? "-"}`,
  );

  return confirmed.url;
};
