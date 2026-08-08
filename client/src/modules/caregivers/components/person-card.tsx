/**
 * One linked person, as a card that stands on its own.
 *
 * The counterpart to `LinkRow`, which packs people into a single grouped
 * surface separated by hairlines. That shape is right for settings — a list of
 * switches where the group *is* the subject — and wrong here: these are
 * people, and a row of a table is not how you present one. Separated cards
 * give each person their own edge, room for a larger avatar, and space for the
 * relationship to be a labelled chip rather than a fragment of a subtitle.
 *
 * `LinkRow` stays for the compact lists (sent invites) where a person is
 * genuinely a line item — a pending invite to a phone number is not yet a
 * person the app knows anything about.
 *
 * The avatar is `md`, up from the row's `sm`. It is the reason this component
 * exists: at 36dp a face is a smudge, and the screen's whole point is
 * recognising who has access to your medical history.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { useTheme } from '@/hooks/use-theme';

export type PersonCardProps = {
  firstname?: string;
  lastname?: string;
  /** Full display name, already prefixed with "คุณ" by the caller. */
  name: string;
  avatarUri?: string;
  /** Phone, or whatever secondary identifier this side of the link has. */
  detail: string;
  /**
   * Relationship or permission, shown as chips under the name.
   *
   * A chip with `onPress` becomes its own control and gains a pencil — used
   * by the permission chip, where the thing you would tap to change a grant
   * is the chip already stating it. It sits inside the card's `onOpen`
   * target, so it stops propagation the way the remove button avoids the
   * problem by being outside it.
   */
  chips?: {
    label: string;
    tone?: 'neutral' | 'accent';
    onPress?: () => void;
    accessibilityLabel?: string;
    testID?: string;
  }[];
  /**
   * Opens this person's data. The whole card becomes tappable and gains a
   * chevron; the remove action keeps its own hit box so "view" and "unlink"
   * are never one mis-tap apart.
   */
  onOpen?: () => void;
  openLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
  removeIcon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
};

export function PersonCard({
  firstname,
  lastname,
  name,
  avatarUri,
  detail,
  chips = [],
  onOpen,
  openLabel = 'ดูข้อมูลของ',
  onRemove,
  removeLabel = 'ลบ',
  removeIcon = 'trash-outline',
  testID,
}: PersonCardProps) {
  const colors = useTheme();

  const body = (
    <View className="flex-1 flex-row items-center">
      <View className="mr-3.5">
        <Avatar uri={avatarUri} firstname={firstname} lastname={lastname} size="md" />
      </View>

      <View className="flex-1">
        <ThemedText type="default" weight="bold">
          {name}
        </ThemedText>
        <ThemedText
          type="body"
          weight="regular"
          themeColor="text-secondary"
          className="mt-0.5"
        >
          {detail}
        </ThemedText>

        {chips.length > 0 ? (
          <View className="mt-2 flex-row flex-wrap gap-1.5">
            {chips.map((chip) => {
              const inner = (
                <>
                  <ThemedText
                    type="caption"
                    weight="semibold"
                    themeColor="text-secondary"
                    style={chip.tone === 'accent' ? { color: '#FFFFFF' } : undefined}
                  >
                    {chip.label}
                  </ThemedText>
                  {chip.onPress ? (
                    <Ionicons
                      name="pencil"
                      size={11}
                      color={chip.tone === 'accent' ? '#FFFFFF' : colors['text-secondary']}
                      style={{ marginLeft: 4 }}
                    />
                  ) : null}
                </>
              );

              const fill = chip.tone === 'accent' ? colors.accent : colors['surface-muted'];

              return chip.onPress ? (
                <Pressable
                  key={chip.label}
                  testID={chip.testID}
                  onPress={chip.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={chip.accessibilityLabel ?? chip.label}
                  className="flex-row items-center rounded-full border px-2.5 py-1"
                  style={({ pressed }) => ({
                    backgroundColor: fill,
                    borderColor: colors['border-strong'],
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  {inner}
                </Pressable>
              ) : (
                <View
                  key={chip.label}
                  className="flex-row items-center rounded-full px-2.5 py-1"
                  style={{ backgroundColor: fill }}
                >
                  {inner}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      {onOpen ? (
        <Ionicons name="chevron-forward" size={20} color={colors['text-secondary']} />
      ) : null}
    </View>
  );

  return (
    <View
      testID={testID}
      className="mb-3 flex-row items-center rounded-2xl border p-4"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors['border-strong'],
        minHeight: 84,
      }}
    >
      {onOpen ? (
        <Pressable
          testID={testID ? `${testID}-open` : undefined}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${openLabel} ${name}`}
          className="flex-1 flex-row items-center"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}

      {onRemove ? (
        <Pressable
          testID={testID ? `${testID}-remove` : undefined}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`${removeLabel} ${name}`}
          // 48dp around a 20px glyph, and outside the open target above.
          className="ml-1 items-center justify-center rounded-xl"
          style={({ pressed }) => ({
            minWidth: 48,
            minHeight: 48,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name={removeIcon} size={20} color={colors.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}
