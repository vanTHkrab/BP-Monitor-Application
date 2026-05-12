import { File } from "expo-file-system";
import {
  GQL_CONFIRM_IMAGE_UPLOAD,
  GQL_REQUEST_IMAGE_UPLOAD,
  GQL_UPLOAD_BLOOD_PRESSURE_IMAGE,
  GQL_UPLOAD_PROFILE_IMAGE,
  graphqlRequest,
} from "@/constants/api";

export type UploadImageKind = "profile" | "blood-pressure";

// GraphQL ImageKind enum values on the server.
const SERVER_IMAGE_KIND: Record<UploadImageKind, string> = {
  profile: "PROFILE",
  "blood-pressure": "BLOOD_PRESSURE_READING",
};

interface UploadImageResponse {
  key: string;
  url: string;
  bucket: string;
  imageId?: number;
}

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

const getFileNameFromUri = (uri: string) => {
  const clean = uri.split("?")[0];
  return clean.split("/").pop() || `image-${Date.now()}.jpg`;
};

const getMimeTypeFromUri = (uri: string) => {
  const lower = uri.split("?")[0].toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
};

export const isRemoteImageUri = (uri?: string | null) =>
  Boolean(uri && /^https?:\/\//i.test(uri));

export const uploadImageToS3 = async ({
  uri,
  kind,
  token,
}: {
  uri: string;
  kind: UploadImageKind;
  token: string;
}) => {
  if (isRemoteImageUri(uri)) {
    console.log(`[S3 upload] skip remote image kind=${kind} uri=${uri}`);
    return uri;
  }

  const fileName = getFileNameFromUri(uri);
  const mimeType = getMimeTypeFromUri(uri);

  console.log(
    `[S3 upload] start kind=${kind} fileName=${fileName} mimeType=${mimeType}`,
  );

  let base64 = "";
  try {
    base64 = await new File(uri).base64();
    console.log(
      `[S3 upload] file-ready kind=${kind} fileName=${fileName} base64Length=${base64.length}`,
    );
  } catch (error) {
    console.error(
      `[S3 upload] file-read-failed kind=${kind} fileName=${fileName}`,
      error,
    );
    throw error;
  }

  const query =
    kind === "profile"
      ? GQL_UPLOAD_PROFILE_IMAGE
      : GQL_UPLOAD_BLOOD_PRESSURE_IMAGE;
  const field =
    kind === "profile" ? "uploadProfileImage" : "uploadBloodPressureImage";

  let data: Record<string, UploadImageResponse>;
  try {
    console.log(`[S3 upload] request kind=${kind} fileName=${fileName}`);
    data = await graphqlRequest<Record<string, UploadImageResponse>>(
      query,
      {
        input: {
          base64,
          mimeType,
          fileName,
        },
      },
      token,
    );
  } catch (error) {
    console.error(
      `[S3 upload] request-failed kind=${kind} fileName=${fileName}`,
      error,
    );
    throw error;
  }

  console.log(
    `[S3 upload] success kind=${kind} key=${data[field].key} bucket=${data[field].bucket}`,
  );

  return data[field].url;
};

/**
 * Upload an image directly to S3 via a presigned URL.
 *
 * Flow: gateway issues a presigned PUT URL → mobile uploads binary
 * straight to S3 → gateway verifies and records the object.
 *
 * Preferred over `uploadImageToS3` for new code: the image never
 * passes through the gateway, so gateway memory + base64 overhead
 * are both gone.
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

  let bytes: Uint8Array;
  try {
    bytes = await new File(uri).bytes();
  } catch (error) {
    console.error(`[S3 presign] file-read-failed kind=${kind} uri=${uri}`, error);
    throw error;
  }
  const size = bytes.byteLength;

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

  let putRes: Response;
  try {
    // Cast: expo-file-system returns Uint8Array<ArrayBuffer>, but TS widens
    // the generic at the call site so BlobPart's strict typing rejects it.
    const body = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
    putRes = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers,
      body,
    });
  } catch (error) {
    console.error(`[S3 presign] put-failed kind=${kind} key=${presign.key}`, error);
    throw error;
  }
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => "");
    console.error(
      `[S3 presign] put-rejected kind=${kind} key=${presign.key} status=${putRes.status} body=${body.slice(0, 200)}`,
    );
    throw new Error(`S3 upload rejected (${putRes.status})`);
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
