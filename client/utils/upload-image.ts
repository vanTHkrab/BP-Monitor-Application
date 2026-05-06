import { File } from "expo-file-system";
import {
  GQL_UPLOAD_BLOOD_PRESSURE_IMAGE,
  GQL_UPLOAD_PROFILE_IMAGE,
  graphqlRequest,
} from "@/constants/api";

export type UploadImageKind = "profile" | "blood-pressure";

interface UploadImageResponse {
  key: string;
  url: string;
  bucket: string;
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
