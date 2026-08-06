/**
 * One linked person, inside a grouped surface.
 *
 * Deliberately close in shape to `modules/security`'s `SecurityRow` /
 * `SecurityGroup` — same 64dp floor, same inset divider, same grouped card —
 * but not reused from there: these rows lead with a person's avatar rather
 * than a state icon, and their trailing slot is a destructive action rather
 * than a chevron. Importing the security row and passing an `accessory` would
 * have meant an avatar squeezed into a 44dp icon circle it was not built for.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { useTheme } from '@/hooks/use-theme';

export type LinkRowProps = {
  firstname?: string;
  lastname?: string;
  /** Full display name — used when only a combined string is available. */
  name: string;
  avatarUri?: string;
  /** The line under the name: phone · relationship, or a waiting note. */
  detail: string;
  /** Dimmed treatment for rows that are not active yet (sent invites). */
  muted?: boolean;
  /**
   * Opens this person's data. When set, the name/detail area becomes the
   * tappable target and gains a chevron — the destructive action keeps its
   * own separate hit box so "view" and "unlink" can never be one mis-tap
   * apart.
   */
  onOpen?: () => void;
  openLabel?: string;
  /** Trailing destructive action. */
  onRemove?: () => void;
  removeLabel?: string;
  removeIcon?: keyof typeof Ionicons.glyphMap;
  isLast?: boolean;
  testID?: string;
};

export function LinkRow({
  firstname,
  lastname,
  name,
  avatarUri,
  detail,
  muted = false,
  onOpen,
  openLabel = 'ดูข้อมูลของ',
  onRemove,
  removeLabel = 'ลบ',
  removeIcon = 'trash-outline',
  isLast = false,
  testID,
}: LinkRowProps) {
  const colors = useTheme();

  return (
    <View>
      <View
        testID={testID}
        className="flex-row items-center px-4"
        // Matches SecurityRow's 64dp floor — elderly-first, and these rows sit
        // next to each other in the same scroll.
        style={{ minHeight: 64, opacity: muted ? 0.7 : 1 }}
      >
        <View className="mr-3.5">
          {muted ? (
            <View
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: colors['surface-muted'] }}
            >
              <Ionicons name="time-outline" size={22} color={colors['text-secondary']} />
            </View>
          ) : (
            <Avatar uri={avatarUri} firstname={firstname} lastname={lastname} size="sm" />
          )}
        </View>

        {onOpen ? (
          <Pressable
            testID={testID ? `${testID}-open` : undefined}
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={`${openLabel} ${name}`}
            className="flex-1 flex-row items-center py-3 pr-2"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View className="flex-1">
              <ThemedText type="default">{name}</ThemedText>
              <ThemedText
                type="small"
                weight="regular"
                themeColor="text-secondary"
                className="mt-0.5"
              >
                {detail}
              </ThemedText>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors['text-secondary']}
            />
          </Pressable>
        ) : (
          <View className="flex-1 py-3 pr-3">
            <ThemedText type="default">{name}</ThemedText>
            <ThemedText
              type="small"
              weight="regular"
              themeColor="text-secondary"
              className="mt-0.5"
            >
              {detail}
            </ThemedText>
          </View>
        )}

        {onRemove ? (
          <Pressable
            testID={testID ? `${testID}-remove` : undefined}
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`${removeLabel} ${name}`}
            // 48dp hit area around a 20px glyph.
            className="items-center justify-center rounded-xl"
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

      {isLast ? null : (
        <View className="ml-[68px] h-px" style={{ backgroundColor: colors.border }} />
      )}
    </View>
  );
}

/** The surface the rows sit in. Mirrors `SecurityGroup`. */
export function LinkGroup({ title, children }: { title: string; children: ReactNode }) {
  const colors = useTheme();

  return (
    <View className="mb-2 mt-6">
      <ThemedText
        type="caption"
        weight="semibold"
        themeColor="text-secondary"
        className="mb-2.5 ml-1 uppercase"
        style={{ letterSpacing: 0.5 }}
      >
        {title}
      </ThemedText>

      <View className="overflow-hidden rounded-2xl" style={{ backgroundColor: colors.surface }}>
        {children}
      </View>
    </View>
  );
}
