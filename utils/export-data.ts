import { BloodPressureReading, CommunityPost } from '@/types';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

export type ExportDataType = 'readings' | 'posts';
export type ExportFormat = 'csv' | 'pdf';

export interface ExportPayloadOptions {
  dataType: ExportDataType;
  format: ExportFormat;
  readings: BloodPressureReading[];
  posts: CommunityPost[];
  userName?: string | null;
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
    } catch {
      // ignore if already exists
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
        } catch {
          // ignore cleanup failure
        }
        return { type: 'fs', uri: tempDir };
      }
    } catch {
      // fall through to SAF/throw
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

const toIsoString = (value: Date | string | number): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
};

const csvEscape = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const escapeHtml = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

const buildReadingsCsv = (readings: BloodPressureReading[]): string => {
  const header = ['id', 'systolic', 'diastolic', 'pulse', 'status', 'measuredAt', 'notes', 'imageUri'];
  const rows = readings.map((r) => [
    r.id,
    r.systolic,
    r.diastolic,
    r.pulse,
    r.status,
    toIsoString(r.measuredAt),
    r.notes ?? '',
    r.imageUri ?? '',
  ]);

  return [header.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');
};

const buildPostsCsv = (posts: CommunityPost[]): string => {
  const header = ['id', 'userId', 'userName', 'category', 'content', 'likes', 'comments', 'createdAt'];
  const rows = posts.map((p) => [
    p.id,
    p.userId,
    p.userName,
    p.category,
    p.content,
    p.likes,
    p.comments,
    toIsoString(p.createdAt),
  ]);

  return [header.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');
};

const buildReadingsPdfHtml = (readings: BloodPressureReading[], userName?: string | null): string => {
  const rows = readings
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(r.id)}</td>
          <td>${escapeHtml(r.systolic)}</td>
          <td>${escapeHtml(r.diastolic)}</td>
          <td>${escapeHtml(r.pulse)}</td>
          <td>${escapeHtml(r.status)}</td>
          <td>${escapeHtml(toIsoString(r.measuredAt))}</td>
          <td>${escapeHtml(r.notes ?? '')}</td>
        </tr>
      `
    )
    .join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #1f2937; padding: 16px; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          h2 { font-size: 14px; font-weight: normal; margin: 0 0 16px; color: #6b7280; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>รายงานค่าความดัน</h1>
        <h2>ผู้ใช้: ${escapeHtml(userName ?? '-')} | สร้างเมื่อ: ${escapeHtml(toIsoString(new Date()))}</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>SYS</th>
              <th>DIA</th>
              <th>Pulse</th>
              <th>Status</th>
              <th>Measured At</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </body>
    </html>
  `;
};

const buildPostsPdfHtml = (posts: CommunityPost[], userName?: string | null): string => {
  const rows = posts
    .map(
      (p) => `
        <tr>
          <td>${escapeHtml(p.id)}</td>
          <td>${escapeHtml(p.userName)}</td>
          <td>${escapeHtml(p.category)}</td>
          <td>${escapeHtml(p.content)}</td>
          <td>${escapeHtml(p.likes)}</td>
          <td>${escapeHtml(p.comments)}</td>
          <td>${escapeHtml(toIsoString(p.createdAt))}</td>
        </tr>
      `
    )
    .join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #1f2937; padding: 16px; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          h2 { font-size: 14px; font-weight: normal; margin: 0 0 16px; color: #6b7280; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>รายงานโพสต์ชุมชน</h1>
        <h2>ผู้ใช้: ${escapeHtml(userName ?? '-')} | สร้างเมื่อ: ${escapeHtml(toIsoString(new Date()))}</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Category</th>
              <th>Content</th>
              <th>Likes</th>
              <th>Comments</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </body>
    </html>
  `;
};

const buildFileNameBase = (dataType: ExportDataType): string => {
  const prefix = dataType === 'readings' ? 'bp-readings' : 'bp-posts';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${timestamp}`;
};

const createCsvFile = async (content: string, dataType: ExportDataType, attempt: number): Promise<string> => {
  const exportDir = await ensureExportDir();
  const baseName = buildFileNameBase(dataType);
  const fileName = `${baseName}-${attempt}.csv`;

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

const createPdfFile = async (html: string, dataType: ExportDataType, attempt: number): Promise<string> => {
  const exportDir = await ensureExportDir();
  const baseName = buildFileNameBase(dataType);
  const fileName = `${baseName}-${attempt}.pdf`;
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
  const { dataType, format, readings, posts, userName } = options;

  if (dataType === 'readings' && readings.length === 0) {
    throw new Error('ไม่พบข้อมูลค่าความดันสำหรับส่งออก');
  }

  if (dataType === 'posts' && posts.length === 0) {
    throw new Error('ไม่พบข้อมูลโพสต์สำหรับส่งออก');
  }

  try {
    if (format === 'csv') {
      const content = dataType === 'readings' ? buildReadingsCsv(readings) : buildPostsCsv(posts);
      return createCsvFile(content, dataType, attempt);
    }

    const html =
      dataType === 'readings'
        ? buildReadingsPdfHtml(readings, userName)
        : buildPostsPdfHtml(posts, userName);
    return createPdfFile(html, dataType, attempt);
  } catch (error) {
    const details = stringifyErrorSafe(error);
    throw new Error(`สร้างไฟล์ไม่สำเร็จ (attempt ${attempt})${details ? `: ${details}` : ''}`);
  }
};

export const createExportFileWithRetry = async (options: ExportPayloadOptions, maxAttempts = 3): Promise<string> => {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await createExportFile(options, attempt);
    } catch (error) {
      lastError = error;
      console.error('Export attempt failed:', { attempt, error });
    }
  }

  const details = stringifyErrorSafe(lastError);
  if (details) {
    throw new Error(`${details}\nไม่สามารถสร้างไฟล์ได้หลังลอง ${maxAttempts} ครั้ง`);
  }
  throw new Error(`ไม่สามารถสร้างไฟล์ได้หลังลอง ${maxAttempts} ครั้ง`);
};
