/**
 * Export: whose name goes on the document, and what the user is told.
 *
 * `lib/export.test.ts` proves the file contents. What is unasserted is the
 * wrapper the three exporting screens share, and the one field in it that is
 * a data-integrity question rather than a formatting one: `subjectName`.
 * A caregiver exporting the patient they are viewing must get the *patient's*
 * name, because `useReadings` already queried with the patient's id — getting
 * it wrong files one person's blood pressure under another person's name, in
 * a PDF that then leaves the app.
 *
 * `resolveExportSubjectName` is left real for that reason: stubbing it would
 * move the only decision this hook makes out of the test.
 *
 * The outcome copy is asserted verbatim. It is Thai, user-facing, and the
 * three screens rely on this hook rather than writing their own — a silent
 * change here changes what every export says.
 */
const mockShow = jest.fn();
jest.mock('tamagui', () => ({
  useToastController: () => ({ show: (...a: unknown[]) => mockShow(...a) }),
}));

jest.mock('@/modules/auth', () => require('./__fixtures__/identity').authModuleMock());

jest.mock('@/modules/caregivers', () => require('./__fixtures__/identity').caregiversModuleMock());

const mockShareReadingsExport = jest.fn();
jest.mock('../services/export-file', () => {
  // A real class rather than a stand-in. The hook branches on
  // `error instanceof EmptyExportError` and resolves that name through this
  // module, so this *is* the class it checks against — and the message it
  // renders is the one carried here.
  class EmptyExportError extends Error {
    constructor() {
      super('ไม่พบข้อมูลค่าความดันสำหรับส่งออก');
      this.name = 'EmptyExportError';
    }
  }
  return {
    EmptyExportError,
    shareReadingsExport: (...a: unknown[]) => mockShareReadingsExport(...a),
  };
});

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { EmptyExportError } from '../services/export-file';
import type { Reading } from '../types';
import {
  actAsCaregiverViewingPatient,
  CAREGIVER,
  identity,
  PATIENT,
  resetIdentity,
  SELF,
} from './__fixtures__/identity';
import { useExportReadings } from './use-export-readings';

const reading = (remoteId: number): Reading => ({
  key: `remote-${remoteId}`,
  remoteId,
  userId: SELF.id,
  systolic: 120,
  diastolic: 80,
  pulse: 70,
  measuredAt: new Date('2026-02-01T09:00:00.000Z'),
  status: 'normal',
  createdAt: new Date('2026-02-01T09:00:01.000Z'),
  syncState: 'synced',
});

const READINGS = [reading(1), reading(2), reading(3)];

const renderExport = () => renderHook(() => useExportReadings());

async function exportPdf(
  view: Awaited<ReturnType<typeof renderExport>>,
  readings: Reading[] = READINGS,
) {
  await act(async () => {
    await view.result.current.exportReadings(readings, 'pdf');
  });
}

/** The single argument object `shareReadingsExport` was handed. */
const exportRequest = () => mockShareReadingsExport.mock.calls[0][0];

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockShareReadingsExport.mockReset();
  mockShareReadingsExport.mockResolvedValue('shared');
  resetIdentity();
  // The hook logs through `console.warn` under `__DEV__`, which jest leaves
  // on. Silenced rather than left to scroll past a real failure.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('whose name goes on the document', () => {
  it('sends the whole request in one object, with the signed-in user name', async () => {
    const view = await renderExport();
    await exportPdf(view);

    // `toEqual`, not a field check: a stray extra key here ends up in the
    // PDF header or the filename, and the filename is what gets shared.
    expect(exportRequest()).toEqual({
      readings: READINGS,
      format: 'pdf',
      subjectName: `${SELF.firstname} ${SELF.lastname}`,
    });
  });

  it('names the patient, not the caregiver, when a caregiver exports', async () => {
    actAsCaregiverViewingPatient();

    const view = await renderExport();
    await exportPdf(view);

    // The readings on screen are the patient's — `useReadings` queried with
    // their id. A document carrying the caregiver's name attributes one
    // person's medical data to another.
    expect(exportRequest().subjectName).toBe(`${PATIENT.firstname} ${PATIENT.lastname}`);
    expect(exportRequest().subjectName).not.toContain(CAREGIVER.firstname);
  });

  it('drops the name rather than guessing when there is no user yet', async () => {
    // `useSession().user` is a query result and is null for the first frames
    // after a cold start. `undefined` removes the name segment from the
    // filename entirely, which is better than labelling the file with a guess.
    identity.user = null;

    const view = await renderExport();
    await exportPdf(view);

    expect(exportRequest().subjectName).toBeUndefined();
  });

  it('passes the format through rather than assuming PDF', async () => {
    const view = await renderExport();
    await act(async () => {
      await view.result.current.exportReadings(READINGS, 'csv');
    });

    expect(exportRequest().format).toBe('csv');
  });
});

describe('what the user is told', () => {
  it('confirms the format and the row count on success', async () => {
    const view = await renderExport();
    await exportPdf(view);

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith('สร้างไฟล์ PDF แล้ว', {
        message: '3 รายการ',
        customData: { tone: 'success' },
      }),
    );
  });

  it('labels a CSV export CSV', async () => {
    const view = await renderExport();
    await act(async () => {
      await view.result.current.exportReadings(READINGS, 'csv');
    });

    expect(mockShow).toHaveBeenCalledWith('สร้างไฟล์ CSV แล้ว', {
      message: '3 รายการ',
      customData: { tone: 'success' },
    });
  });

  it('explains that the web build cannot export', async () => {
    mockShareReadingsExport.mockResolvedValue('unsupported-platform');

    const view = await renderExport();
    await exportPdf(view);

    expect(mockShow).toHaveBeenCalledWith('ส่งออกไม่สำเร็จ', {
      message: 'การส่งออกไฟล์ใช้ได้บนแอปมือถือเท่านั้น',
      customData: { tone: 'error' },
    });
  });

  it('explains a device with no share sheet', async () => {
    mockShareReadingsExport.mockResolvedValue('unsupported-device');

    const view = await renderExport();
    await exportPdf(view);

    expect(mockShow).toHaveBeenCalledWith('ส่งออกไม่สำเร็จ', {
      message: 'อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์',
      customData: { tone: 'error' },
    });
  });

  it('shows exactly one toast for a failed outcome', async () => {
    // The success toast lands while the OS share sheet animates in. Showing
    // it *as well as* the failure toast is worse than showing neither.
    mockShareReadingsExport.mockResolvedValue('unsupported-device');

    const view = await renderExport();
    await exportPdf(view);

    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('repeats the empty-export message rather than a generic one', async () => {
    mockShareReadingsExport.mockRejectedValue(new EmptyExportError());

    const view = await renderExport();
    await exportPdf(view, []);

    expect(mockShow).toHaveBeenCalledWith('ส่งออกไม่สำเร็จ', {
      message: 'ไม่พบข้อมูลค่าความดันสำหรับส่งออก',
      customData: { tone: 'error' },
    });
  });

  it('does not leak a raw failure message into the toast', async () => {
    // The invariant across this app: raw English never reaches the UI. A
    // filesystem or print error message is English and unhelpful.
    mockShareReadingsExport.mockRejectedValue(new Error('ENOSPC: no space left on device'));

    const view = await renderExport();
    await exportPdf(view);

    expect(mockShow).toHaveBeenCalledWith('ส่งออกไม่สำเร็จ', {
      message: 'ไม่สามารถสร้างไฟล์ได้ กรุณาลองใหม่อีกครั้ง',
      customData: { tone: 'error' },
    });
  });
});

describe('the busy flag', () => {
  it('is set while the file is being built and cleared afterwards', async () => {
    let finish: (outcome: string) => void = () => {};
    mockShareReadingsExport.mockImplementation(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );

    const view = await renderExport();
    await act(async () => {
      void view.result.current.exportReadings(READINGS, 'pdf');
    });

    expect(view.result.current.isExporting).toBe(true);

    await act(async () => {
      finish('shared');
    });

    expect(view.result.current.isExporting).toBe(false);
  });

  it('ignores a second tap while the first export is still running', async () => {
    // A PDF render is long enough to tap twice, and every caller only
    // disables its control on an empty list.
    let finish: (outcome: string) => void = () => {};
    mockShareReadingsExport.mockImplementation(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );

    const view = await renderExport();
    await act(async () => {
      void view.result.current.exportReadings(READINGS, 'pdf');
    });

    // Re-read from `result.current`, as a re-rendered button would: the
    // guard lives in a `useCallback` that closes over `isExporting`, so the
    // stale closure a test could hold does not have it. See the report.
    await act(async () => {
      await view.result.current.exportReadings(READINGS, 'pdf');
    });

    expect(mockShareReadingsExport).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish('shared');
    });
  });

  it('is cleared after a failure, so the control comes back', async () => {
    mockShareReadingsExport.mockRejectedValue(new Error('boom'));

    const view = await renderExport();
    await exportPdf(view);

    expect(view.result.current.isExporting).toBe(false);
  });
});
