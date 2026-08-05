/**
 * The export flow, as one call a screen can make.
 *
 * Three screens export — home (PDF, whole history), settings (whole history,
 * either format) and history (the range on screen) — and all three need the
 * same three things around `services/export-file`: resolve *whose* readings
 * these are, keep a busy flag so the control cannot be tapped twice, and turn
 * the outcome into a message. Duplicating that is how three screens end up
 * disagreeing about which name goes on the document.
 *
 * This is also why `services/export-file.ts` stays out of the module's public
 * surface, matching the rule in `index.ts`: a screen calling it directly would
 * have to resolve the subject name itself, and getting that wrong files one
 * person's blood pressure under another person's name.
 *
 * **Outcomes are toasts, not `Alert.alert`.** An Alert is modal — it stops the
 * app and demands a tap. That is right for a decision and wrong for a report,
 * and it is actively wrong for the success case here, which lands while the OS
 * share sheet is animating in. The format question, being an actual decision,
 * is a Tamagui sheet the screens own (`components/export-format-sheet.tsx`).
 */
import { useCallback, useState } from 'react';
import { useToastController } from 'tamagui';

import { useSession } from '@/modules/auth';
import { useActivePatient } from '@/modules/caregivers';

import { resolveExportSubjectName } from '../lib/export';
import {
  EmptyExportError,
  shareReadingsExport,
  type ExportFormat,
} from '../services/export-file';
import type { Reading } from '../types';

/** The outcomes that are not exceptions. `shared` needs no toast of its own. */
const OUTCOME_MESSAGE: Record<string, string> = {
  'unsupported-platform': 'การส่งออกไฟล์ใช้ได้บนแอปมือถือเท่านั้น',
  'unsupported-device': 'อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์',
};

const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF', csv: 'CSV' };

export function useExportReadings() {
  const { user } = useSession();
  const { patient } = useActivePatient();
  const toast = useToastController();
  const [isExporting, setIsExporting] = useState(false);

  const exportReadings = useCallback(
    async (readings: Reading[], format: ExportFormat) => {
      // Guards the double tap. Every caller also disables its control on an
      // empty list, but a slow PDF render is long enough to tap twice.
      if (isExporting) return;

      setIsExporting(true);
      try {
        const outcome = await shareReadingsExport({
          readings,
          format,
          subjectName: resolveExportSubjectName(user, patient),
        });

        const failure = OUTCOME_MESSAGE[outcome];
        if (failure) {
          toast.show('ส่งออกไม่สำเร็จ', { message: failure, customData: { tone: 'error' } });
          return;
        }

        toast.show(`สร้างไฟล์ ${FORMAT_LABEL[format]} แล้ว`, {
          message: `${readings.length} รายการ`,
          customData: { tone: 'success' },
        });
      } catch (error) {
        if (__DEV__) console.warn('[export] failed', error);

        toast.show('ส่งออกไม่สำเร็จ', {
          message:
            error instanceof EmptyExportError
              ? error.message
              : 'ไม่สามารถสร้างไฟล์ได้ กรุณาลองใหม่อีกครั้ง',
          customData: { tone: 'error' },
        });
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting, patient, toast, user],
  );

  return { exportReadings, isExporting };
}
