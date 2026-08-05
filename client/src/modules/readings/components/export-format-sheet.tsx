/**
 * "PDF or CSV?", asked once for all three export entry points.
 *
 * Replaces the `Alert.alert` with two buttons that settings and history each
 * had their own copy of. Three reasons it is worth a component rather than a
 * dialog call:
 *
 *   - **An Alert cannot say what it is exporting.** The row count and the
 *     period are what tell someone they are about to export the right thing,
 *     and an Alert's body is a single unstyled string.
 *   - **Two copies of a two-button dialog drift.** They already differed in
 *     title ("ส่งออกรายงาน" vs "ส่งออกข้อมูล") for no reason a user could see.
 *   - **It is assertable.** A test can find the PDF button and press it. The
 *     Alert version could only be tested by reaching into `Alert.alert`'s mock
 *     and invoking the callback at index 0 — which passes just as happily when
 *     the buttons are in the wrong order.
 *
 * Tamagui rather than a hand-rolled `<Modal>`: the app already mounts
 * `TamaguiProvider` and `tamagui.config.ts` is already wired to the shared
 * tokens, so the sheet is themed correctly for free. Until this component,
 * nothing in the tree actually used Tamagui — the provider was the whole of it.
 */
import { Ionicons } from '@expo/vector-icons';
import { Button, H4, Paragraph, Sheet, XStack, YStack } from 'tamagui';

import { palette } from '@/theme';

import type { ExportFormat } from '../services/export-file';

export type ExportFormatSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (format: ExportFormat) => void;
  /** What is about to be exported, e.g. "ช่วง 30 วัน · 12 รายการ". */
  summary: string;
  /** Overridden by the history sheet, which is about a range not everything. */
  title?: string;
};

const OPTIONS: {
  format: ExportFormat;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    format: 'pdf',
    label: 'PDF',
    hint: 'รายงานพร้อมพิมพ์ เหมาะกับการส่งให้แพทย์',
    icon: 'document-text-outline',
  },
  {
    format: 'csv',
    label: 'CSV',
    hint: 'ตารางข้อมูล เปิดใน Excel หรือ Google Sheets ได้',
    icon: 'grid-outline',
  },
];

export function ExportFormatSheet({
  open,
  onOpenChange,
  onSelect,
  summary,
  title = 'ส่งออกรายงาน',
}: ExportFormatSheetProps) {
  const pick = (format: ExportFormat) => {
    // Closed first: the share sheet is a native surface, and racing it with a
    // JS sheet still animating out leaves the export behind the overlay on
    // Android.
    onOpenChange(false);
    onSelect(format);
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
          <H4 color="$text-primary">{title}</H4>
          <Paragraph color="$text-secondary" size="$3">
            {summary}
          </Paragraph>
        </YStack>

        {OPTIONS.map((option) => (
          <Button
            key={option.format}
            testID={`export-format-${option.format}`}
            accessibilityLabel={`${option.label} — ${option.hint}`}
            onPress={() => pick(option.format)}
            height="auto"
            py="$3"
            px="$3.5"
            bg="$surface-muted"
            borderColor="$border"
            borderWidth={1}
            rounded="$6"
            justify="flex-start"
          >
            <XStack items="center" gap="$3" grow={1}>
              <Ionicons name={option.icon} size={24} color={palette.purple} />
              <YStack grow={1} gap="$0.5">
                <Paragraph color="$text-primary" fontWeight="700" size="$5">
                  {option.label}
                </Paragraph>
                <Paragraph color="$text-secondary" size="$2" whiteSpace="normal">
                  {option.hint}
                </Paragraph>
              </YStack>
            </XStack>
          </Button>
        ))}

        <Button
          testID="export-format-cancel"
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
