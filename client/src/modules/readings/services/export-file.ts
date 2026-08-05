/**
 * Writes a readings export to disk and hands it to the OS share sheet.
 *
 * The document itself is built by `../lib/export.ts`; this file is only
 * plumbing. Ported from `client-old/utils/export-data.ts`, minus most of it.
 *
 * ## Why this is a third of the size of the original
 *
 * client-old ran on `expo-file-system/legacy`, whose `documentDirectory` can
 * be `undefined`. It therefore carried two fallbacks — probing for a temp
 * directory via a throwaway `printToFileAsync` on iOS, and a full Storage
 * Access Framework branch on Android that asked the user to pick a folder —
 * plus a 3-attempt retry loop with numbered filenames around the whole thing.
 *
 * This tree is already on the modern `File` / `Directory` / `Paths` API (see
 * `../lib/pending-image-store.ts`). `Paths.cache` is always present, so the
 * directory can never be missing and none of those branches has a trigger.
 * The retry loop went with them: it existed to survive a half-written file
 * from a failed attempt, and every remaining failure mode here — no space, no
 * permission — fails the same way three times in a row.
 *
 * Cache rather than document storage on purpose: the share sheet copies the
 * bytes into whatever the user picks, so this app has no reason to hold the
 * file afterwards. Letting the OS evict it is the correct lifetime.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { buildExportFileName, buildReadingsCsv, buildReadingsPdfHtml } from '../lib/export';
import type { Reading } from '../types';

export type ExportFormat = 'csv' | 'pdf';

export type ExportRequest = {
  readings: Reading[];
  format: ExportFormat;
  /** Whose readings these are — see `resolveExportSubjectName`. */
  subjectName?: string | null;
};

/**
 * Why an export did not open the share sheet. Returned rather than thrown:
 * neither is an error the user caused, and both want their own message.
 */
export type ExportOutcome =
  | 'shared'
  /** Web has no share sheet and no file system to write to. */
  | 'unsupported-platform'
  /** A device or simulator with no sharing UI available. */
  | 'unsupported-device';

const EXPORT_DIR_NAME = 'exports';

/** Thrown when there is nothing to put in the file. Callers gate on this too. */
export class EmptyExportError extends Error {
  constructor() {
    super('ไม่พบข้อมูลค่าความดันสำหรับส่งออก');
    this.name = 'EmptyExportError';
  }
}

function exportDirectory(): Directory {
  const dir = new Directory(Paths.cache, EXPORT_DIR_NAME);
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/**
 * A previous export of the same range produces the same filename. Overwriting
 * is deliberate: the alternative is `BP-Report_…_2.pdf` accumulating in the
 * cache, and the second file would hold identical content anyway.
 */
function freshFile(dir: Directory, fileName: string): File {
  const file = new File(dir, fileName);
  if (file.exists) file.delete();
  return file;
}

function writeCsv(csv: string, baseName: string): string {
  const file = freshFile(exportDirectory(), `${baseName}.csv`);
  file.create();
  file.write(csv);
  return file.uri;
}

async function writePdf(html: string, baseName: string): Promise<string> {
  // `printToFileAsync` picks its own temp name, so the render and the rename
  // are two steps. Renaming matters as much as rendering here — the share
  // sheet shows the filename and nothing else.
  const { uri } = await Print.printToFileAsync({ html });
  const target = freshFile(exportDirectory(), `${baseName}.pdf`);
  await new File(uri).move(target);
  return target.uri;
}

/**
 * Builds the export file and returns its `file://` URI.
 *
 * Exported separately from `shareReadingsExport` so a test — or a future
 * "save to Files" path — can assert on the file without opening a share
 * sheet that has no meaning outside a device.
 */
export async function createExportFile({
  readings,
  format,
  subjectName,
}: ExportRequest): Promise<string> {
  if (readings.length === 0) throw new EmptyExportError();

  const baseName = buildExportFileName({ readings, subjectName });

  if (format === 'csv') {
    return writeCsv(buildReadingsCsv(readings), baseName);
  }

  return writePdf(buildReadingsPdfHtml(readings, { subjectName }), baseName);
}

/** Build the file, then open the OS share sheet on it. */
export async function shareReadingsExport(request: ExportRequest): Promise<ExportOutcome> {
  if (Platform.OS === 'web') return 'unsupported-platform';

  const fileUri = await createExportFile(request);

  if (!(await Sharing.isAvailableAsync())) return 'unsupported-device';

  await Sharing.shareAsync(fileUri, {
    mimeType: request.format === 'csv' ? 'text/csv' : 'application/pdf',
    // iOS only, and it is what stops the sheet titling the sheet "Item".
    UTI: request.format === 'csv' ? 'public.comma-separated-values-text' : 'com.adobe.pdf',
  });

  return 'shared';
}
