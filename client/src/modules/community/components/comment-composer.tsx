/**
 * The input bar pinned under a comment thread.
 *
 * Grows with the text up to a ceiling — a one-line box that scrolls its own
 * content hides what you just typed, and an unbounded one eats the thread.
 *
 * When editing, the bar says so and offers a way out. client-old put the
 * thread into edit mode with no visible indication beyond the text appearing
 * in the box, so the only way to discover you were about to overwrite a
 * comment was to send it.
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';

export const COMMENT_MAX_LENGTH = 1000;

export type CommentComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  /** Set while editing an existing comment — swaps the copy and shows cancel. */
  isEditing: boolean;
  onCancelEdit: () => void;
};

export function CommentComposer({
  value,
  onChangeText,
  onSubmit,
  isSubmitting,
  isEditing,
  onCancelEdit,
}: CommentComposerProps) {
  const colors = useTheme();
  const fontScale = useFontScale();

  const canSubmit = value.trim().length > 0 && !isSubmitting;

  return (
    <View
      className="border-t px-4 pb-2 pt-2"
      style={{ borderTopColor: colors.border, backgroundColor: colors.background }}
    >
      {isEditing ? (
        <View className="mb-2 flex-row items-center px-1">
          <Ionicons name="pencil" size={14} color={colors.primary} />
          <Text
            className="ml-1.5 flex-1 font-medium"
            style={{ fontSize: Math.round(13 * fontScale), color: colors.primary }}
          >
            กำลังแก้ไขความคิดเห็นของคุณ
          </Text>
          <Pressable
            testID="comment-cancel-edit"
            onPress={onCancelEdit}
            accessibilityRole="button"
            accessibilityLabel="ยกเลิกการแก้ไข"
            className="items-center justify-center px-2"
            style={{ minHeight: 36 }}
          >
            <Text
              className="font-semibold"
              style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
            >
              ยกเลิก
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View className="flex-row items-end">
        <TextInput
          testID="comment-input"
          className="flex-1 rounded-2xl px-4 py-2.5"
          style={{
            // Roughly one line up to about four, then it scrolls its own
            // content rather than pushing the thread off screen.
            minHeight: 44,
            maxHeight: 120,
            fontSize: Math.round(15 * fontScale),
            color: colors['text-primary'],
            backgroundColor: colors['surface-muted'],
          }}
          placeholder="เขียนความคิดเห็น…"
          placeholderTextColor={colors['text-secondary']}
          value={value}
          onChangeText={onChangeText}
          editable={!isSubmitting}
          maxLength={COMMENT_MAX_LENGTH}
          multiline
        />

        <Pressable
          testID="comment-submit"
          onPress={onSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={isEditing ? 'บันทึกการแก้ไข' : 'ส่งความคิดเห็น'}
          accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
          className="ml-2 items-center justify-center rounded-full"
          style={{
            width: 44,
            height: 44,
            backgroundColor: canSubmit ? colors.primary : colors['surface-muted'],
          }}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors['text-secondary']} />
          ) : (
            <Ionicons
              name={isEditing ? 'checkmark' : 'send'}
              size={19}
              color={canSubmit ? '#FFFFFF' : colors['text-secondary']}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}
