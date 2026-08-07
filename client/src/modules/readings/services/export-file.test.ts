/**
 * The export plumbing — the boundary between the pure document builders in
 * `../lib/export.ts` and the disk plus the OS share sheet.
 *
 * The builders are tested in `../lib/export.test.ts` and are used for real
 * here, so the assertions below are about the four things only this layer
 * decides: that the bytes written are the bytes the builder produced, that the
 * file carries the name the share sheet will show, that an empty export never
 * reaches the disk at all, and that the share sheet is told the right type.
 *
 * `expo-file-system`, `expo-print` and `expo-sharing` are replaced at the
 * package boundary; nothing above them is stubbed.
 */
jest.mock('expo-file-system', () => {
  const fs = {
    dirExists: true,
    createdDirs: 0,
    /** Filename → contents, inside the `exports` directory. */
    files: new Map<string, string>(),
    deleted: [] as string[],
    moves: [] as { from: string; to: string }[],
  };

  const DIR_URI = 'file:///cache/exports';

  class MockFile {
    name: string;
    uri: string;

    constructor(parent: unknown, name?: string) {
      if (typeof name === 'string') {
        this.name = name;
        this.uri = `${DIR_URI}/${name}`;
      } else {
        this.uri = String(parent);
        this.name = this.uri.split('/').pop() ?? '';
      }
    }

    get exists(): boolean {
      return fs.files.has(this.name);
    }

    create(): void {
      fs.files.set(this.name, '');
    }

    write(contents: string): void {
      fs.files.set(this.name, contents);
    }

    delete(): void {
      fs.files.delete(this.name);
      fs.deleted.push(this.name);
    }

    async move(target: MockFile): Promise<void> {
      fs.moves.push({ from: this.uri, to: target.uri });
      fs.files.set(target.name, fs.files.get(this.name) ?? 'pdf-bytes');
      fs.files.delete(this.name);
    }
  }

  class MockDirectory {
    name: string;

    constructor(_parent: unknown, name?: string) {
      this.name = name ?? '';
    }

    get exists(): boolean {
      return fs.dirExists;
    }

    create(): void {
      fs.dirExists = true;
      fs.createdDirs += 1;
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: 'file:///doc', cache: 'file:///cache' },
    __fs: fs,
  };
});

jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(async () => ({ uri: 'file:///cache/print/tmp-9f3a.pdf' })),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { buildExportFileName, buildReadingsCsv, buildReadingsPdfHtml } from '../lib/export';
import type { Reading } from '../types';
import {
  EmptyExportError,
  createExportFile,
  shareReadingsExport,
  type ExportFormat,
} from './export-file';

type VirtualFs = {
  dirExists: boolean;
  createdDirs: number;
  files: Map<string, string>;
  deleted: string[];
  moves: { from: string; to: string }[];
};

const fs = (jest.requireMock('expo-file-system') as { __fs: VirtualFs }).__fs;

const printToFileAsync = Print.printToFileAsync as jest.MockedFunction<
  typeof Print.printToFileAsync
>;
const isAvailableAsync = Sharing.isAvailableAsync as jest.MockedFunction<
  typeof Sharing.isAvailableAsync
>;
const shareAsync = Sharing.shareAsync as jest.MockedFunction<typeof Sharing.shareAsync>;

const reading = (over: Partial<Reading> = {}): Reading => ({
  key: 'remote-1',
  remoteId: 1,
  userId: 'user-1',
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: new Date('2026-07-29T08:00:00.000Z'),
  status: 'elevated',
  createdAt: new Date('2026-07-29T08:00:01.000Z'),
  syncState: 'synced',
  ...over,
});

const ONE = [reading()];
const SUBJECT = 'สมชาย ใจดี';

/** The name the share sheet will show, from the real builder. */
const baseNameFor = (readings: Reading[], subjectName?: string) =>
  buildExportFileName({ readings, subjectName });

/**
 * `Platform.OS` is a getter under jest-expo and defaults to 'ios'; the web
 * branch is an early return that would otherwise never be reached.
 */
function onPlatform(os: 'ios' | 'web', run: () => Promise<void>) {
  return async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    try {
      await run();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }
  };
}

beforeEach(() => {
  fs.dirExists = true;
  fs.createdDirs = 0;
  fs.files.clear();
  fs.deleted = [];
  fs.moves = [];

  printToFileAsync.mockReset().mockResolvedValue({ uri: 'file:///cache/print/tmp-9f3a.pdf' } as never);
  isAvailableAsync.mockReset().mockResolvedValue(true);
  shareAsync.mockReset().mockResolvedValue(undefined);
});

describe('createExportFile — the empty set', () => {
  /*
   * A zero-row export is the one case where writing the file is worse than
   * refusing: the user gets a document that looks like a clean bill of health
   * for a period they simply have no data for. The builders happily produce a
   * header-only CSV, so the refusal has to live here.
   */
  it.each<ExportFormat>(['csv', 'pdf'])('refuses a %s export with no readings', async (format) => {
    await expect(createExportFile({ readings: [], format })).rejects.toBeInstanceOf(
      EmptyExportError,
    );
  });

  it('writes nothing and renders nothing when there is nothing to export', async () => {
    await expect(createExportFile({ readings: [], format: 'pdf' })).rejects.toThrow();

    expect([...fs.files.keys()]).toEqual([]);
    expect(printToFileAsync).not.toHaveBeenCalled();
  });

  // The message reaches the patient, so it stays Thai — see root AGENTS.md
  // rule 7. The name is what callers branch on.
  it('carries a user-facing Thai message under a branchable name', () => {
    const error = new EmptyExportError();

    expect(error.name).toBe('EmptyExportError');
    expect(error.message).toBe('ไม่พบข้อมูลค่าความดันสำหรับส่งออก');
  });
});

describe('createExportFile — CSV', () => {
  it('writes exactly what the builder produced', async () => {
    await createExportFile({ readings: ONE, format: 'csv' });

    const [contents] = [...fs.files.values()];
    expect(contents).toBe(buildReadingsCsv(ONE));
  });

  // The BOM is what stops Excel on Windows rendering every Thai column as
  // mojibake, and it only survives if the bytes are written verbatim.
  it('keeps the byte-order mark the builder puts at the front', async () => {
    await createExportFile({ readings: ONE, format: 'csv' });

    const [contents] = [...fs.files.values()];
    expect(contents.startsWith('﻿')).toBe(true);
  });

  it('names the file after the export, in the exports directory', async () => {
    const uri = await createExportFile({ readings: ONE, format: 'csv', subjectName: SUBJECT });

    expect(uri).toBe(`file:///cache/exports/${baseNameFor(ONE, SUBJECT)}.csv`);
  });

  it('creates the exports directory on the first export after an install', async () => {
    fs.dirExists = false;

    await createExportFile({ readings: ONE, format: 'csv' });

    expect(fs.createdDirs).toBe(1);
  });

  /*
   * Same readings, same filename. Overwriting is deliberate — the alternative
   * is `…_2.csv` accumulating in the cache with byte-identical content — but
   * it only holds if the stale file is removed first rather than appended to.
   */
  it('replaces a previous export of the same range instead of accumulating', async () => {
    await createExportFile({ readings: ONE, format: 'csv' });
    await createExportFile({ readings: ONE, format: 'csv' });

    expect(fs.files.size).toBe(1);
    expect(fs.deleted).toEqual([`${baseNameFor(ONE)}.csv`]);
  });

  // A subject name is user-supplied. `sanitizeFileNameSegment` strips the
  // separators; this pins that nothing downstream reintroduces a path.
  it('cannot be made to write outside the exports directory by a subject name', async () => {
    const uri = await createExportFile({
      readings: ONE,
      format: 'csv',
      subjectName: '../../secrets/x',
    });

    expect(uri.startsWith('file:///cache/exports/')).toBe(true);
    expect(uri.slice('file:///cache/exports/'.length)).not.toContain('/');
  });
});

describe('createExportFile — PDF', () => {
  it('renders exactly the html the builder produced', async () => {
    await createExportFile({ readings: ONE, format: 'pdf', subjectName: SUBJECT });

    expect(printToFileAsync).toHaveBeenCalledWith({
      html: buildReadingsPdfHtml(ONE, { subjectName: SUBJECT }),
    });
  });

  /*
   * `printToFileAsync` picks its own temp name, and the share sheet shows the
   * filename and nothing else. Returning the temp URI would hand a clinician
   * a file called `tmp-9f3a.pdf`, so the rename matters as much as the render.
   */
  it('renames the rendered file to the export name before returning it', async () => {
    const uri = await createExportFile({ readings: ONE, format: 'pdf', subjectName: SUBJECT });

    expect(uri).toBe(`file:///cache/exports/${baseNameFor(ONE, SUBJECT)}.pdf`);
    expect(fs.moves).toEqual([
      {
        from: 'file:///cache/print/tmp-9f3a.pdf',
        to: `file:///cache/exports/${baseNameFor(ONE, SUBJECT)}.pdf`,
      },
    ]);
  });

  it('leaves no temp file behind under the printer’s own name', async () => {
    await createExportFile({ readings: ONE, format: 'pdf' });

    expect([...fs.files.keys()]).toEqual([`${baseNameFor(ONE)}.pdf`]);
  });

  it('replaces a previous PDF of the same range', async () => {
    await createExportFile({ readings: ONE, format: 'pdf' });
    await createExportFile({ readings: ONE, format: 'pdf' });

    expect(fs.deleted).toContain(`${baseNameFor(ONE)}.pdf`);
    expect(fs.files.size).toBe(1);
  });
});

describe('shareReadingsExport', () => {
  it('tells the share sheet a CSV is a CSV', async () => {
    await expect(shareReadingsExport({ readings: ONE, format: 'csv' })).resolves.toBe('shared');

    expect(shareAsync).toHaveBeenCalledWith(`file:///cache/exports/${baseNameFor(ONE)}.csv`, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    });
  });

  // The UTI is iOS-only and is what stops the sheet titling itself "Item".
  it('tells the share sheet a PDF is a PDF', async () => {
    await expect(shareReadingsExport({ readings: ONE, format: 'pdf' })).resolves.toBe('shared');

    expect(shareAsync).toHaveBeenCalledWith(`file:///cache/exports/${baseNameFor(ONE)}.pdf`, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    });
  });

  // A device with no sharing UI is not an error the user caused, so it gets
  // its own outcome rather than a thrown exception.
  it('reports an unsupported device instead of throwing', async () => {
    isAvailableAsync.mockResolvedValue(false);

    await expect(shareReadingsExport({ readings: ONE, format: 'csv' })).resolves.toBe(
      'unsupported-device',
    );
    expect(shareAsync).not.toHaveBeenCalled();
  });

  it('propagates the empty-export refusal rather than opening an empty sheet', async () => {
    await expect(
      shareReadingsExport({ readings: [], format: 'csv' }),
    ).rejects.toBeInstanceOf(EmptyExportError);

    expect(shareAsync).not.toHaveBeenCalled();
  });

  it(
    'reports an unsupported platform on web without touching the disk',
    onPlatform('web', async () => {
      await expect(shareReadingsExport({ readings: ONE, format: 'csv' })).resolves.toBe(
        'unsupported-platform',
      );

      expect([...fs.files.keys()]).toEqual([]);
      expect(shareAsync).not.toHaveBeenCalled();
    }),
  );

  /*
   * Ordering, and it is observable: the platform check runs before the empty
   * check, so an empty export on web is reported as unsupported rather than
   * as having no data. Pinned because swapping the two would change which
   * message the user sees.
   */
  it(
    'reports the platform before the empty set on web',
    onPlatform('web', async () => {
      await expect(shareReadingsExport({ readings: [], format: 'csv' })).resolves.toBe(
        'unsupported-platform',
      );
    }),
  );
});
