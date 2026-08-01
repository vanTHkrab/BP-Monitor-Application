/**
 * One comment.
 *
 * Flat — no indentation, no reply affordance. `parentId` is on the schema and
 * on the type, but rendering a thread is a feature this port does not add.
 *
 * The edit/delete control follows the same rule as the post card: it renders
 * only for the author, rather than existing for everyone and explaining
 * itself away in a dialog.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';

import { formatRelativeTimeTH } from '../lib/relative-time';
import type { Comment } from '../types';

const LIKED_COLOR = '#E91E63';

export type CommentRowProps = {
  comment: Comment;
  isOwner: boolean;
  onLike: () => void;
  onMore?: () => void;
  /** Dimmed while its own edit is in flight. */
  isPending?: boolean;
};

export function CommentRow({
  comment,
  isOwner,
  onLike,
  onMore,
  isPending = false,
}: CommentRowProps) {
  const colors = useTheme();
  const fontScale = useFontScale();

  const bodySize = Math.round(15 * fontScale);

  return (
    <View
      testID={`comment-${comment.id}`}
      className="mb-3 flex-row"
      style={{ opacity: isPending ? 0.5 : 1 }}
    >
      <Avatar uri={comment.userAvatar} firstname={comment.userName} size="sm" />

      <View className="ml-2.5 flex-1">
        <View className="rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: colors.surface }}>
          <View className="flex-row items-center">
            <Text
              className="flex-1 font-semibold"
              numberOfLines={1}
              style={{ fontSize: Math.round(14 * fontScale), color: colors['text-primary'] }}
            >
              {comment.userName}
            </Text>

            {isOwner && onMore ? (
              <Pressable
                testID={`comment-${comment.id}-more`}
                onPress={onMore}
                accessibilityRole="button"
                accessibilityLabel="จัดการความคิดเห็นของฉัน"
                className="items-center justify-center"
                // Smaller than the 44dp floor used elsewhere, and deliberately
                // so: at 44 the hit area of a menu nobody needs would overlap
                // the comment text above it in a dense thread.
                style={{ minWidth: 36, minHeight: 36 }}
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={16}
                  color={colors['text-secondary']}
                />
              </Pressable>
            ) : null}
          </View>

          <Text
            className="mt-1"
            style={{
              fontSize: bodySize,
              lineHeight: bodySize + 7,
              color: colors['text-primary'],
            }}
          >
            {comment.content}
          </Text>
        </View>

        <View className="mt-1 flex-row items-center pl-1">
          <Text
            style={{ fontSize: Math.round(12 * fontScale), color: colors['text-secondary'] }}
          >
            {formatRelativeTimeTH(comment.createdAt)}
            {comment.updatedAt ? ' · แก้ไขแล้ว' : ''}
          </Text>

          <Pressable
            testID={`comment-${comment.id}-like`}
            onPress={onLike}
            accessibilityRole="button"
            accessibilityLabel={
              comment.isLiked ? 'เลิกถูกใจความคิดเห็นนี้' : 'ถูกใจความคิดเห็นนี้'
            }
            className="ml-3 flex-row items-center"
            style={({ pressed }) => ({ minHeight: 36, opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons
              name={comment.isLiked ? 'heart' : 'heart-outline'}
              size={15}
              color={comment.isLiked ? LIKED_COLOR : colors['text-secondary']}
            />
            {comment.likes > 0 ? (
              <Text
                className="ml-1 font-medium"
                style={{
                  fontSize: Math.round(12 * fontScale),
                  color: comment.isLiked ? LIKED_COLOR : colors['text-secondary'],
                }}
              >
                {comment.likes}
              </Text>
            ) : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
