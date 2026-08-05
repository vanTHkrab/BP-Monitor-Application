/**
 * Switch which patient a caregiver is looking at, from wherever they are.
 *
 * Before this, changing patient meant leaving the context by hand, opening the
 * menu, opening the invitations screen, and tapping a row — four taps and two
 * screens to answer a question the banner is already showing the answer to.
 * Opened from the banner, it is two.
 *
 * **Each row leads with the patient's latest reading**, which is why
 * `myPatients` was extended to carry it. A list of names answers "who am I
 * linked to"; a caregiver opening this is asking "who needs attention", and
 * only one of those is worth a screen. Patients with a concerning reading sort
 * first for the same reason.
 *
 * Read-only links are labelled here rather than only at the camera. Finding
 * out you cannot record after switching to someone is a wasted switch.
 */
import { Ionicons } from '@expo/vector-icons';
import { Button, H4, Paragraph, Sheet, XStack, YStack } from 'tamagui';

/*
 * Deep import, deliberately, and the one place this module does it.
 * `@/modules/readings`'s barrel reaches `use-export-readings`, which imports
 * `useSubject` from *this* module — so going through the barrel makes
 * caregivers → readings → caregivers a genuine cycle, and the symptom is an
 * undefined export several files away. The status helpers are pure and have
 * no further imports.
 */
import { statusLabel } from '../../readings/lib/status';
import type { BPStatus } from '../../readings/types';
import { palette } from '@/theme';
import { formatThaiDateTime } from '@/utils/thai-date';

import type { PatientSummary } from '../types';

export type PatientSwitcherSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: PatientSummary[];
  /** Highlighted as current; still tappable, which just closes the sheet. */
  activePatientId?: string;
  onSelect: (patient: PatientSummary) => void;
};

/**
 * Tamagui colour props take theme tokens, not the hex `statusColorFor`
 * returns. `tamagui.config.ts` spreads the BP `status` palette into both
 * themes, so these token names resolve to exactly the same colours the rest
 * of the app draws with.
 */
// `as const` matters: annotating this `Record<BPStatus, string>` widens the
// values and Tamagui's colour props only accept the literal token types.
const STATUS_TOKEN = {
  low: '$low',
  normal: '$normal',
  elevated: '$elevated',
  high: '$high',
  critical: '$critical',
} as const satisfies Record<BPStatus, string>;

/** Worst first — a caregiver opens this to find who needs attention. */
const SEVERITY: Record<string, number> = {
  critical: 0,
  high: 1,
  low: 2,
  elevated: 3,
  normal: 4,
};

export function sortByAttention(patients: PatientSummary[]): PatientSummary[] {
  return [...patients].sort((a, b) => {
    // A patient with no readings at all is not "fine" — they are unknown, and
    // unknown belongs above normal but below anything actually concerning.
    const rank = (p: PatientSummary) =>
      p.latestReading ? (SEVERITY[p.latestReading.status] ?? 4) : 3.5;
    const delta = rank(a) - rank(b);
    if (delta !== 0) return delta;
    return a.firstname.localeCompare(b.firstname, 'th');
  });
}

export function PatientSwitcherSheet({
  open,
  onOpenChange,
  patients,
  activePatientId,
  onSelect,
}: PatientSwitcherSheetProps) {
  const ordered = sortByAttention(patients);

  const pick = (patient: PatientSummary) => {
    onOpenChange(false);
    if (patient.id !== activePatientId) onSelect(patient);
  };

  return (
    <Sheet
      modal
      open={open}
      onOpenChange={onOpenChange}
      snapPointsMode="fit"
      dismissOnSnapToBottom
      transition="quick"
    >
      <Sheet.Overlay
        transition="quick"
        enterStyle={{ opacity: 0 }}
        exitStyle={{ opacity: 0 }}
        bg="rgba(0,0,0,0.45)"
      />
      <Sheet.Handle />
      <Sheet.Frame
        bg="$surface"
        borderTopLeftRadius="$8"
        borderTopRightRadius="$8"
        px="$4"
        pt="$3"
        pb="$6"
        gap="$3"
      >
        <YStack gap="$1">
          <H4 color="$text-primary">เลือกผู้ป่วย</H4>
          <Paragraph color="$text-secondary" size="$3">
            {`คุณดูแลอยู่ ${patients.length} คน`}
          </Paragraph>
        </YStack>

        {ordered.map((patient) => {
          const reading = patient.latestReading;
          const isActive = patient.id === activePatientId;

          return (
            <Button
              key={patient.id}
              testID={`patient-switch-${patient.id}`}
              accessibilityLabel={
                `คุณ${patient.firstname} ${patient.lastname}` +
                (reading ? ` ล่าสุด ${statusLabel(reading.status)}` : ' ยังไม่มีการวัด') +
                (patient.permission === 'view' ? ' ดูได้อย่างเดียว' : '')
              }
              onPress={() => pick(patient)}
              height="auto"
              py="$3"
              px="$3.5"
              bg={isActive ? '$surface' : '$surface-muted'}
              borderColor={isActive ? '$accent' : '$border'}
              borderWidth={isActive ? 2 : 1}
              rounded="$6"
              justify="flex-start"
            >
              <XStack items="center" gap="$3" grow={1}>
                <YStack grow={1} gap="$0.5">
                  <XStack items="center" gap="$2">
                    <Paragraph color="$text-primary" fontWeight="700" size="$5">
                      {`คุณ${patient.firstname}`}
                    </Paragraph>
                    {patient.permission === 'view' ? (
                      <Paragraph color="$text-secondary" size="$1">
                        · ดูอย่างเดียว
                      </Paragraph>
                    ) : null}
                  </XStack>

                  <Paragraph
                    color={reading ? STATUS_TOKEN[reading.status] : '$text-secondary'}
                    size="$2"
                    whiteSpace="normal"
                  >
                    {reading
                      ? `${reading.systolic}/${reading.diastolic} · ${statusLabel(reading.status)} · ${formatThaiDateTime(reading.measuredAt)}`
                      : 'ยังไม่มีการวัด'}
                  </Paragraph>
                </YStack>

                {isActive ? (
                  <Ionicons name="checkmark-circle" size={22} color={palette.purple} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color="#9AA0A6" />
                )}
              </XStack>
            </Button>
          );
        })}

        <Button
          testID="patient-switch-cancel"
          onPress={() => onOpenChange(false)}
          chromeless
          color="$text-secondary"
        >
          ยกเลิก
        </Button>
      </Sheet.Frame>
    </Sheet>
  );
}
