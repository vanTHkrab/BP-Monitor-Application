/**
 * Compose or edit a post.
 *
 * A form sheet, and it stays a modal rather than becoming a route: unlike the
 * comment thread, this is a single text box with no scrolling content of its
 * own, and it is opened *over* the feed it is posting into — losing that
 * context is the cost of a route, for no gain.
 *
 * client-old put an `Alert` confirm in front of both posting and saving an
 * edit ("ต้องการโพสต์ข้อความนี้ใช่ไหม?"). Neither is destructive and both are
 * editable afterwards, so the dialog bought nothing and taught people to
 * dismiss confirmations without reading — which is exactly what you do not
 * want when the delete confirm appears. It is gone. Delete still confirms.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientButton } from '@/components/ui/gradient-button';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { formatErrorMessage } from '@/lib/error-message';

import { CategoryTabs } from './category-tabs';
import { categoryHint } from '../lib/categories';
import type { PostCategory } from '../types';

export const POST_MAX_LENGTH = 2000;
/** Warn only near the ceiling — a counter on an empty box is just noise. */
const COUNTER_VISIBLE_FROM = POST_MAX_LENGTH - 200;

export type PostComposerProps = {
  visible: boolean;
  /** Set when editing; the copy and the button change accordingly. */
  mode: 'create' | 'edit';
  initialContent?: string;
  initialCategory: PostCategory;
  isSubmitting: boolean;
  onSubmit: (values: { content: string; category: PostCategory }) => Promise<void>;
  onClose: () => void;
};

export function PostComposer({
  visible,
  mode,
  initialContent = '',
  initialCategory,
  isSubmitting,
  onSubmit,
  onClose,
}: PostComposerProps) {
  const colors = useTheme();
  const fontScale = useFontScale();
  const insets = useSafeAreaInsets();

  const [content, setContent] = useState(initialContent);
  const [category, setCategory] = useState<PostCategory>(initialCategory);
  const [error, setError] = useState<string | null>(null);

  // Remounting on open is what re-seeds these from the props — see the `key`
  // the feed passes. Seeding with an effect would set state during render.
  const trimmed = content.trim();
  const canSubmit = trimmed.length > 0 && !isSubmitting;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);

    try {
      await onSubmit({ content: trimmed, category });
    } catch (caught) {
      setError(
        formatErrorMessage(
          caught,
          mode === 'edit' ? 'บันทึกการแก้ไขไม่สำเร็จ' : 'โพสต์ไม่สำเร็จ กรุณาลองใหม่',
        ),
      );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
        style={{ backgroundColor: colors.background }}
      >
        <View
          className="flex-row items-center px-4 py-3"
          style={{ paddingTop: insets.top + 12 }}
        >
          <Pressable
            testID="composer-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="ปิด"
            className="items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <Ionicons name="close" size={26} color={colors['text-primary']} />
          </Pressable>

          <Text
            className="flex-1 text-center font-bold"
            style={{ fontSize: Math.round(18 * fontScale), color: colors['text-primary'] }}
          >
            {mode === 'edit' ? 'แก้ไขโพสต์' : 'เขียนโพสต์'}
          </Text>

          <View style={{ width: 44 }} />
        </View>

        <View className="flex-1 px-0">
          <CategoryTabs value={category} onChange={setCategory} />

          <Text
            className="mb-2 px-5"
            style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
          >
            {categoryHint(category)}
          </Text>

          <View className="flex-1 px-4">
            <TextInput
              testID="composer-input"
              className="flex-1 rounded-2xl px-4 py-3"
              style={{
                fontSize: Math.round(16 * fontScale),
                lineHeight: Math.round(24 * fontScale),
                color: colors['text-primary'],
                backgroundColor: colors.surface,
                textAlignVertical: 'top',
              }}
              placeholder="แบ่งปันเรื่องราวหรือคำถามของคุณ…"
              placeholderTextColor={colors['text-secondary']}
              value={content}
              onChangeText={(text) => {
                setContent(text);
                if (error) setError(null);
              }}
              editable={!isSubmitting}
              maxLength={POST_MAX_LENGTH}
              multiline
              autoFocus
            />

            {content.length >= COUNTER_VISIBLE_FROM ? (
              <Text
                className="mt-1.5 text-right"
                style={{
                  fontSize: Math.round(12 * fontScale),
                  color: colors['text-secondary'],
                }}
              >
                {`${content.length} / ${POST_MAX_LENGTH}`}
              </Text>
            ) : null}

            {error ? (
              <Text
                className="mt-2 px-1"
                accessibilityLiveRegion="polite"
                style={{ fontSize: Math.round(14 * fontScale), color: colors.danger }}
              >
                {error}
              </Text>
            ) : null}
          </View>

          <View className="px-4 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
            <GradientButton
              testID="composer-submit"
              title={mode === 'edit' ? 'บันทึกการแก้ไข' : 'โพสต์'}
              onPress={() => void submit()}
              disabled={!canSubmit}
              loading={isSubmitting}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
