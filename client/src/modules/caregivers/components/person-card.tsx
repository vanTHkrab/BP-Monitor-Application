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
import { Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';

export type PersonCardProps = {
  firstname?: string;
  lastname?: string;
  /** Full display name, already prefixed with "คุณ" by the caller. */
  name: string;
  avatarUri?: string;
  /** Phone, or whatever secondary identifier this side of the link has. */
  detail: string;
  /** Relationship or permission, shown as chips under the name. */
  chips?: { label: string; tone?: 'neutral' | 'accent' }[];
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
  const fontScale = useFontScale();

  const body = (
    <View className="flex-1 flex-row items-center">
      <View className="mr-3.5">
        <Avatar uri={avatarUri} firstname={firstname} lastname={lastname} size="md" />
      </View>

      <View className="flex-1">
        <Text
          className="font-bold"
          style={{ fontSize: Math.round(16 * fontScale), color: colors['text-primary'] }}
        >
          {name}
        </Text>
        <Text
          className="mt-0.5"
          style={{ fontSize: Math.round(14 * fontScale), color: colors['text-secondary'] }}
        >
          {detail}
        </Text>

        {chips.length > 0 ? (
          <View className="mt-2 flex-row flex-wrap gap-1.5">
            {chips.map((chip) => (
              <View
                key={chip.label}
                className="rounded-full px-2.5 py-1"
                style={{
                  backgroundColor:
                    chip.tone === 'accent' ? colors.accent : colors['surface-muted'],
                }}
              >
                <Text
                  className="font-semibold"
                  style={{
                    fontSize: Math.round(12 * fontScale),
                    color:
                      chip.tone === 'accent' ? '#FFFFFF' : colors['text-secondary'],
                  }}
                >
                  {chip.label}
                </Text>
              </View>
            ))}
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
