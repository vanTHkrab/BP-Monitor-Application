/**
 * Change what an already-accepted caregiver may do.
 *
 * Until this existed the only route from `full` back to `view` was removing
 * the link and being re-invited — dropping the relationship, its history, and
 * the caregiver's access all at once to change one column. In practice that
 * meant nobody downgraded, so every grant a patient had made stayed at
 * whatever they picked in the seconds after the invite arrived.
 *
 * **A sheet rather than an `Alert`**, for the same reason `ExportFormatSheet`
 * is one: an `Alert` body is a single unstyled string, and this choice needs
 * both options' consequences on screen at once. Same rule as the invite card
 * — a control that only describes the selected option hides the weaker grant
 * from anyone who never taps.
 *
 * **The copy comes from `lib/permission.ts`, shared with the invite card.**
 * The rows are rebuilt here in Tamagui rather than reusing the card's
 * component, because a Tamagui **modal** `Sheet` mounts its content outside
 * the app's provider tree: `useTheme()` and `ThemedText` both throw
 * "must be used inside <ColorSchemeProvider>" in there, and the content stays
 * mounted even while closed, so the throw is not conditional on opening it.
 * `ExportFormatSheet` and `PatientSwitcherSheet` are Tamagui-only for exactly
 * this reason. What must not drift between the two surfaces is the *wording*
 * of what each grant permits, and that is what is shared.
 *
 * **It writes on tap and closes.** No save step: there are two options and one
 * is already selected, so a confirm button would only ever confirm a choice
 * just made explicitly. Tapping the current grant is the no-op that closes,
 * which is what "never mind" looks like here.
 */
import { Ionicons } from '@expo/vector-icons';
import { H4, Paragraph, Sheet, XStack, YStack } from 'tamagui';

import { palette } from '@/theme';

import { PERMISSION_OPTIONS } from '../lib/permission';
import type { CaregiverPermission } from '../types';

export type PermissionSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name for the heading, already prefixed with "คุณ" by the caller. */
  caregiverName: string;
  current: CaregiverPermission;
  onSelect: (permission: CaregiverPermission) => void;
  /** Blocks re-tapping while the mutation is in flight. */
  isPending?: boolean;
};

export function PermissionSheet({
  open,
  onOpenChange,
  caregiverName,
  current,
  onSelect,
  isPending = false,
}: PermissionSheetProps) {
  const pick = (permission: CaregiverPermission) => {
    onOpenChange(false);
    // Tapping what is already granted is how someone leaves this sheet
    // without changing anything — sending it would spend a round trip and a
    // cache invalidation writing the value already in the row.
    if (permission !== current) onSelect(permission);
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
          <H4 color="$text-primary">สิทธิ์ของผู้ดูแล</H4>
          <Paragraph color="$text-secondary" size="$3">
            {`${caregiverName} จะทำอะไรกับข้อมูลของคุณได้บ้าง`}
          </Paragraph>
        </YStack>

        <YStack gap="$2.5">
          {PERMISSION_OPTIONS.map((option) => {
            const selected = current === option.value;

            return (
              <XStack
                key={option.value}
                testID={`permission-sheet-${option.value}`}
                onPress={() => pick(option.value)}
                disabled={isPending}
                accessibilityRole="radio"
                accessibilityLabel={`${option.label} — ${option.consequence}`}
                accessibilityState={{ checked: selected, disabled: isPending }}
                items="center"
                gap="$2.5"
                p="$3"
                rounded="$6"
                minH={64}
                borderWidth={selected ? 2 : 1}
                borderColor={selected ? '$accent' : '$border-strong'}
                bg={selected ? '$surface-muted' : 'transparent'}
                opacity={isPending ? 0.5 : 1}
                pressStyle={{ opacity: 0.85 }}
              >
                {/*
                  `Ionicons` is not a Tamagui component, so `$accent` means
                  nothing to it — the palette import is how `ExportFormatSheet`
                  solves the same problem. `palette.orange` *is* the `accent`
                  token in both schemes; the unselected state borrows the
                  purple rather than `text-secondary`, which differs per scheme
                  and cannot be read in here.
                */}
                <Ionicons
                  name={option.icon}
                  size={20}
                  color={selected ? palette.orange : palette.purpleLight}
                />

                <YStack flex={1} gap="$0.5">
                  <Paragraph color="$text-primary" fontWeight="700" size="$4">
                    {option.label}
                  </Paragraph>
                  <Paragraph color="$text-secondary" size="$2" whiteSpace="normal">
                    {option.consequence}
                  </Paragraph>
                </YStack>

                <XStack
                  width={24}
                  height={24}
                  rounded={12}
                  items="center"
                  justify="center"
                  borderWidth={2}
                  borderColor={selected ? '$accent' : '$border-strong'}
                  bg={selected ? '$accent' : 'transparent'}
                >
                  {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                </XStack>
              </XStack>
            );
          })}
        </YStack>
      </Sheet.Frame>
    </Sheet>
  );
}
