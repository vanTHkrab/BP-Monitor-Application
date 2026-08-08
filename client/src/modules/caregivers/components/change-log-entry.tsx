/**
 * One line of the patient's audit trail, written for the person it is about.
 *
 * This is oversight of someone acting on your behalf, and the reader is an
 * elderly patient — so the row answers the four questions in the order they
 * are asked, and none of them in database vocabulary:
 *
 *   1. **What changed** — the field name, in Thai, as the loudest thing here.
 *   2. **From what to what** — old and new on one line, old dimmed, new in
 *      full-strength text with an arrow between them. The new value is the
 *      one that is true now, so it is the one that reads as the answer.
 *   3. **Who did it** — "คุณแก้ไขเอง" or the caregiver's name. Distinguished
 *      by colour *and* by wording: the point of this screen is telling your
 *      own edits apart from someone else's, and a colour alone fails for the
 *      part of this audience that cannot rely on one.
 *   4. **When**.
 *
 * The arrow is `→` in text rather than an icon so it inherits the font scale;
 * at the largest setting an icon stays 16dp beside 30dp digits and stops
 * reading as a relationship between them.
 *
 * `byPatient` comes from the gateway, not from comparing ids here — `actorId`
 * is null once the actor's account is deleted, and `undefined !== myId` would
 * silently re-attribute the patient's own old edits to a stranger.
 */
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { palette } from '@/theme';
import { formatThaiDateTime } from '@/utils/thai-date';

import { formatHealthValue, healthFieldLabel } from '../lib/health-fields';
import type { ProfileChangeLogEntry } from '../types';

export type ChangeLogEntryRowProps = {
  entry: ProfileChangeLogEntry;
  testID?: string;
};

export function ChangeLogEntryRow({ entry, testID }: ChangeLogEntryRowProps) {
  const colors = useTheme();

  const label = healthFieldLabel(entry.field);
  const before = formatHealthValue(entry.field, entry.oldValue);
  const after = formatHealthValue(entry.field, entry.newValue);

  /*
   * Purple for someone else, matching `ActivePatientBanner` — that colour
   * means "this is about the caregiver relationship" everywhere else in the
   * app, and reusing it here is what makes the screens read as one system.
   */
  const actorTone = entry.byPatient ? colors['text-secondary'] : palette.purple;
  const actorText = entry.byPatient ? 'คุณแก้ไขเอง' : `ผู้ดูแล คุณ${entry.actorName} แก้ไขให้`;

  return (
    <View
      testID={testID}
      className="mb-3 rounded-2xl border p-4"
      style={{ backgroundColor: colors.surface, borderColor: colors['border-strong'] }}
      accessibilityRole="text"
      // One label for the whole row: a screen reader walking five separate
      // fragments ("น้ำหนัก", "60 กก.", "→", …) loses the relationship the
      // layout is carrying.
      accessibilityLabel={`${label} เปลี่ยนจาก ${before} เป็น ${after} ${actorText} เมื่อ ${formatThaiDateTime(entry.changedAt)}`}
    >
      <View className="flex-row items-center">
        <Ionicons
          name={entry.byPatient ? 'person-outline' : 'people-outline'}
          size={18}
          color={actorTone}
        />
        <ThemedText type="default" weight="bold" className="ml-2 flex-1">
          {label}
        </ThemedText>
      </View>

      <View className="mt-2 flex-row flex-wrap items-center">
        <ThemedText
          type="body"
          weight="regular"
          themeColor="text-secondary"
          testID={testID ? `${testID}-old` : undefined}
        >
          {before}
        </ThemedText>
        <ThemedText type="body" weight="regular" themeColor="text-secondary" className="mx-2">
          →
        </ThemedText>
        <ThemedText
          type="body"
          weight="bold"
          testID={testID ? `${testID}-new` : undefined}
        >
          {after}
        </ThemedText>
      </View>

      <View className="mt-2.5 flex-row flex-wrap items-center justify-between">
        <ThemedText type="body" weight="semibold" style={{ color: actorTone }}>
          {actorText}
        </ThemedText>
        <ThemedText type="caption" weight="regular" themeColor="text-secondary">
          {formatThaiDateTime(entry.changedAt)}
        </ThemedText>
      </View>
    </View>
  );
}
