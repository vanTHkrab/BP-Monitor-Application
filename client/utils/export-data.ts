// File I/O + share-sheet plumbing for the data-export feature. The report
// content itself (CSV bodies, PDF HTML, filenames) is built by the pure
// helpers in `utils/export-report.ts`.

import { logWarn } from '@/store/shared/log';
import { BloodPressureReading, CommunityPost } from '@/types';
import {
  buildExportFileName,
  buildPostsCsv,
  buildPostsPdfHtml,
  buildReadingsCsv,
  buildReadingsPdfHtml,
} from '@/utils/export-report';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export type ExportDataType = 'readings' | 'posts';
export type ExportFormat = 'csv' | 'pdf';

export interface ExportPayloadOptions {
  dataType: ExportDataType;
  format: ExportFormat;
  readings: BloodPressureReading[];
  posts: CommunityPost[];
  /**
   * Display name of the data subject — the patient whose readings are being
   * exported. When a caregiver exports while viewing an active patient, pass
   * the patient's name (see `resolveExportSubjectName` in export-report),
   * not the caregiver's. Drives the report header and the filename.
   */
  userName?: string | null;
  /**
   * When true, strip identifiers and image URLs from the exported file
   * (internal IDs, userId, S3 imageUri, recorded-by attribution, subject
   * name). Use when sharing data outside the patient's own device.
   */
  anonymize?: boolean;
}

const EXPORT_DIR_NAME = 'exports';

type ExportDirResult =
  | { type: 'fs'; uri: string }
  | { type: 'saf'; uri: string };

const ensureExportDir = async (): Promise<ExportDirResult> => {
  const documentDir = (FileSystem as any).documentDirectory as string | undefined;
  const cacheDir = (FileSystem as any).cacheDirectory as string | undefined;
  const baseDir = documentDir ?? cacheDir;

  if (baseDir) {
    const exportDir = `${baseDir}${EXPORT_DIR_NAME}/`;
    try {
      await FileSystem.makeDirectoryAsync(exportDir, { intermediates: true } as any);
    } catch (error) {
      // Directory may already exist — only surface unexpected failures in dev.
      logWarn('Export', 'makeDirectoryAsync failed (may already exist)', error);
    }
    return { type: 'fs', uri: exportDir };
  }

  if (Platform.OS === 'ios') {
    try {
      const { uri } = await Print.printToFileAsync({ html: '<html><body></body></html>' });
      const tempDir = uri.slice(0, Math.max(0, uri.lastIndexOf('/') + 1));
      if (tempDir) {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true } as any);
        } catch (error) {
          logWarn('Export', 'temp probe cleanup failed', error);
        }
        return { type: 'fs', uri: tempDir };
      }
    } catch (error) {
      // fall through to SAF/throw
      logWarn('Export', 'printToFileAsync directory probe failed', error);
    }
  }

  const saf = (FileSystem as any).StorageAccessFramework as
    | {
        requestDirectoryPermissionsAsync: () => Promise<{ granted: boolean; directoryUri: string }>;
        createFileAsync: (dirUri: string, fileName: string, mimeType: string) => Promise<string>;
      }
    | undefined;

  if (Platform.OS === 'android' && saf) {
    const permission = await saf.requestDirectoryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('ไม่ได้รับอนุญาตให้เข้าถึงโฟลเดอร์สำหรับบันทึกไฟล์');
    }
    return { type: 'saf', uri: permission.directoryUri };
  }

  throw new Error(
    `ไม่พบพื้นที่จัดเก็บในเครื่อง (platform=${Platform.OS}, documentDir=${String(documentDir)}, cacheDir=${String(cacheDir)})`
  );
};

const stringifyErrorSafe = (error: unknown): string => {
  if (!error) return '';
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    try {
      return String(error);
    } catch {
      return '[unstringifiable error]';
    }
  }
};

// First attempt gets the clean name; retries get a numeric suffix so a
// half-written file from a failed attempt can never be reused by accident.
const withAttemptSuffix = (baseName: string, attempt: number): string =>
  attempt > 1 ? `${baseName}_${attempt}` : baseName;

const createCsvFile = async (content: string, baseName: string, attempt: number): Promise<string> => {
  const exportDir = await ensureExportDir();
  const fileName = `${withAttemptSuffix(baseName, attempt)}.csv`;

  if (exportDir.type === 'saf') {
    const saf = (FileSystem as any).StorageAccessFramework as
      | {
          createFileAsync: (dirUri: string, fileName: string, mimeType: string) => Promise<string>;
        }
      | undefined;
    if (!saf) {
      throw new Error('ไม่รองรับการเข้าถึงโฟลเดอร์ด้วย Storage Access Framework');
    }
    const fileUri = await saf.createFileAsync(
      exportDir.uri,
      fileName,
      'text/csv'
    );
    await FileSystem.writeAsStringAsync(fileUri, content, { encoding: 'utf8' as any });
    return fileUri;
  }

  const fileUri = `${exportDir.uri}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, content, { encoding: 'utf8' as any });
  return fileUri;
};

const createPdfFile = async (html: string, baseName: string, attempt: number): Promise<string> => {
  const exportDir = await ensureExportDir();
  const fileName = `${withAttemptSuffix(baseName, attempt)}.pdf`;
  const { uri } = await Print.printToFileAsync({ html });

  if (exportDir.type === 'saf') {
    const saf = (FileSystem as any).StorageAccessFramework as
      | {
          createFileAsync: (dirUri: string, fileName: string, mimeType: string) => Promise<string>;
        }
      | undefined;
    if (!saf) {
      throw new Error('ไม่รองรับการเข้าถึงโฟลเดอร์ด้วย Storage Access Framework');
    }
    const fileUri = await saf.createFileAsync(
      exportDir.uri,
      fileName,
      'application/pdf'
    );
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
    await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: 'base64' as any });
    return fileUri;
  }

  const fileUri = `${exportDir.uri}${fileName}`;
  await FileSystem.moveAsync({ from: uri, to: fileUri });
  return fileUri;
};

const createExportFile = async (options: ExportPayloadOptions, attempt: number): Promise<string> => {
  const { dataType, format, readings, posts, userName, anonymize = false } = options;

  if (dataType === 'readings' && readings.length === 0) {
    throw new Error('ไม่พบข้อมูลค่าความดันสำหรับส่งออก');
  }

  if (dataType === 'posts' && posts.length === 0) {
    throw new Error('ไม่พบข้อมูลโพสต์สำหรับส่งออก');
  }

  const baseName = buildExportFileName({ dataType, readings, userName, anonymize });

  try {
    if (format === 'csv') {
      const content = dataType === 'readings'
        ? buildReadingsCsv(readings, anonymize)
        : buildPostsCsv(posts, anonymize);
      return createCsvFile(content, baseName, attempt);
    }

    const html =
      dataType === 'readings'
        ? buildReadingsPdfHtml(readings, userName, anonymize)
        : buildPostsPdfHtml(posts, userName, anonymize);
    return createPdfFile(html, baseName, attempt);
  } catch (error) {
    const details = stringifyErrorSafe(error);
    throw new Error(`สร้างไฟล์ไม่สำเร็จ (attempt ${attempt})${details ? `: ${details}` : ''}`);
  }
};

export type ShareReadingsExportResult = 'shared' | 'unsupported-platform' | 'unsupported-device';

/**
 * One-shot helper: build the export file then open the OS share sheet.
 * Returns a status code so callers can show their own messaging.
 * Throws only on file generation failures.
 */
export const shareReadingsExport = async (
  options: ExportPayloadOptions,
  maxAttempts = 3,
): Promise<ShareReadingsExportResult> => {
  if (Platform.OS === 'web') return 'unsupported-platform';

  const fileUri = await createExportFileWithRetry(options, maxAttempts);

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) return 'unsupported-device';

  await Sharing.shareAsync(fileUri);
  return 'shared';
};

export const createExportFileWithRetry = async (options: ExportPayloadOptions, maxAttempts = 3): Promise<string> => {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await createExportFile(options, attempt);
    } catch (error) {
      lastError = error;
      logWarn('Export', 'export attempt failed', error, { attempt });
    }
  }

  const details = stringifyErrorSafe(lastError);
  if (details) {
    throw new Error(`${details}\nไม่สามารถสร้างไฟล์ได้หลังลอง ${maxAttempts} ครั้ง`);
  }
  throw new Error(`ไม่สามารถสร้างไฟล์ได้หลังลอง ${maxAttempts} ครั้ง`);
};
