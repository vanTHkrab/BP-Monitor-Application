/**
 * One post in the feed.
 *
 * Two changes from client-old's card, both removals:
 *
 *   - **The sync badge is gone**, along with the three states it rendered
 *     ("บันทึกในเครื่อง", "รอซิงก์", "ซิงก์ไม่สำเร็จ · ลองใหม่"). Community is
 *     network-only in this tree, so a post either exists on the server or the
 *     compose failed in front of the user. A badge for a queue that does not
 *     exist would be decoration.
 *   - **The "…" menu only renders for the author.** The old card always showed
 *     it, and tapping it on someone else's post opened an Alert that said the
 *     post could only be liked or read — an affordance whose whole purpose was
 *     to tell you it did nothing.
 *
 * The read-more collapse is kept. It measures the laid-out line count rather
 * than guessing from string length, because Thai wraps at different widths
 * than the character heuristic assumes.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { useTypography } from '@/hooks/use-typography';
import { useTheme } from '@/hooks/use-theme';

import { formatRelativeTimeTH } from '../lib/relative-time';
import type { Post } from '../types';

const COLLAPSED_LINES = 4;
const LIKED_COLOR = '#E91E63';

export type PostCardProps = {
  post: Post;
  /** True when the signed-in user wrote it — gates the edit/delete menu. */
  isOwner: boolean;
  onPress: () => void;
  onLike: () => void;
  onComment: () => void;
  onMore?: () => void;
};

export function PostCard({ post, isOwner, onPress, onLike, onComment, onMore }: PostCardProps) {
  const colors = useTheme();
  const typography = useTypography();

  const [isExpanded, setExpanded] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [hasMeasured, setHasMeasured] = useState(false);

  /*
   * Stays a raw `<Text>` — see `docs/project/CLIENT-typography.md` §4. It is
   * measured with `onTextLayout` against a dynamic `numberOfLines` to decide
   * whether to offer "อ่านต่อ", and the body/line-height pair below has to be
   * the one that measurement was taken against. What it does now get is the
   * shared resolver, so a family switch changes the metric the measurement
   * uses instead of leaving it on a stale copy of the arithmetic.
   */
  const bodyStyle = typography({ size: 15, weight: 'regular', lineHeight: 15 + 8 });
  const canExpand = lineCount > COLLAPSED_LINES;

  return (
    <Pressable
      testID={`post-${post.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`โพสต์ของ ${post.userName}`}
      className="mb-3 rounded-2xl p-4 "
      style={{
        backgroundColor: colors.surface,
        // opacity: pressed ? 0.95 : 0,
      }}
    >
      <View className="mb-3 flex-row items-center">
        <Avatar uri={post.userAvatar} firstname={post.userName} size="sm" />

        <View className="ml-2.5 flex-1">
          <ThemedText type="body" weight="semibold" numberOfLines={1}>
            {post.userName}
          </ThemedText>
          <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-0.5">
            {formatRelativeTimeTH(post.createdAt)}
            {post.updatedAt ? ' · แก้ไขแล้ว' : ''}
          </ThemedText>
        </View>

        {isOwner && onMore ? (
          <Pressable
            testID={`post-${post.id}-more`}
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel="จัดการโพสต์ของฉัน"
            className="items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors['text-secondary']} />
          </Pressable>
        ) : null}
      </View>

      <Text
        // Before the first layout pass the line count is unknown, so the text
        // renders unclamped for one frame — clamping first would report 4
        // lines for every post and never offer "อ่านต่อ".
        numberOfLines={isExpanded || !hasMeasured ? undefined : COLLAPSED_LINES}
        onTextLayout={(event) => {
          const lines = event.nativeEvent.lines.length;
          setLineCount((current) => Math.max(current, lines));
          setHasMeasured(true);
        }}
        style={{ ...bodyStyle, color: colors['text-primary'] }}
      >
        {post.content}
      </Text>

      {canExpand ? (
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          className="self-start py-2"
        >
          <ThemedText type="small" weight="bold" themeColor="primary">
            {isExpanded ? 'ย่อข้อความ' : 'อ่านต่อ'}
          </ThemedText>
        </Pressable>
      ) : null}

      <View
        className="mt-3 flex-row items-center border-t pt-1"
        style={{ borderTopColor: colors.border, gap: 4 }}
      >
        <CardAction
          testID={`post-${post.id}-like`}
          icon={post.isLiked ? 'heart' : 'heart-outline'}
          label={String(post.likes)}
          tint={post.isLiked ? LIKED_COLOR : colors['text-secondary']}
          accessibilityLabel={post.isLiked ? 'เลิกถูกใจโพสต์นี้' : 'ถูกใจโพสต์นี้'}
          onPress={onLike}
        />

        <CardAction
          testID={`post-${post.id}-comment`}
          icon="chatbubble-outline"
          label={String(post.comments)}
          tint={colors['text-secondary']}
          accessibilityLabel="อ่านและเขียนความคิดเห็น"
          onPress={onComment}
        />

        <CardAction
          icon="share-social-outline"
          tint={colors['text-secondary']}
          accessibilityLabel="แชร์โพสต์นี้"
          onPress={() => {
            void Share.share({ message: `${post.userName}: ${post.content}` }).catch(() => {
              // The user dismissed the sheet, or the OS refused it. Neither is
              // something to report — the post is unchanged either way.
            });
          }}
        />
      </View>
    </Pressable>
  );
}

function CardAction({
  icon,
  label,
  tint,
  onPress,
  accessibilityLabel,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  tint: string;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="flex-row items-center justify-center rounded-xl px-3"
      style={({ pressed }) => ({ minHeight: 44, opacity: pressed ? 0.6 : 1 })}
      // Stops the tap bubbling to the card's own onPress, which would open
      // the detail route every time someone liked a post.
      onStartShouldSetResponder={() => true}
    >
      <Ionicons name={icon} size={19} color={tint} />
      {label ? (
        <ThemedText type="small" className="ml-1.5" style={{ color: tint }}>
          {label}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}
