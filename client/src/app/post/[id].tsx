/**
 * One post and its comments.
 *
 * This was a `<Modal>` inside `client-old/app/(tabs)/chat.tsx` — a scrolling
 * list with its own composer pinned under it, which is a screen. As a route
 * it gets Android's Back gesture (the modal swallowed it, dropping the user
 * back to the feed instead of closing the thread) and a post becomes
 * something a notification or a caregiver can link to.
 *
 * Comments are flat and online-only. Flat because client-old never rendered
 * a reply and `parentId` is a feature, not a port. Online-only for the same
 * reason the feed is — see the header of `app/(tabs)/post.tsx`.
 *
 * The one structural nuisance: the gateway has no `post(id:)` query, so
 * `usePost` reconstructs the post from the feed when this route is opened
 * cold. See the note on that hook.
 */
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { useTheme } from '@/hooks/use-theme';
import { formatErrorMessage } from '@/lib/error-message';
import { useSession } from '@/modules/auth';
import {
  CommentComposer,
  CommentRow,
  PostCard,
  useCreateComment,
  useDeleteComment,
  usePost,
  usePostComments,
  useToggleCommentLike,
  useToggleLike,
  useUpdateComment,
  type Comment,
} from '@/modules/community';
import { SecurityHeader } from '@/modules/security';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = Number(id);

  const insets = useSafeAreaInsets();
  const { userId } = useSession();

  const { post, isLoading: isLoadingPost, isMissing } = usePost(postId);
  const { comments, isLoading, isRefetching, refetch } = usePostComments(postId);

  const { toggleLike } = useToggleLike();
  const { toggleCommentLike } = useToggleCommentLike(postId);
  const { createComment, isPending: isCreating } = useCreateComment(postId);
  const { updateComment, isPending: isUpdating } = useUpdateComment(postId);
  const { deleteComment } = useDeleteComment(postId);

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitComment = async () => {
    const content = draft.trim();
    if (!content) return;
    setError(null);

    try {
      if (editingId !== null) {
        await updateComment({ id: editingId, content });
        setEditingId(null);
      } else {
        await createComment(content);
      }
      setDraft('');
    } catch (caught) {
      setError(formatErrorMessage(caught, 'ส่งความคิดเห็นไม่สำเร็จ กรุณาลองใหม่'));
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const confirmDeleteComment = (comment: Comment) => {
    Alert.alert('ลบความคิดเห็น', 'ลบความคิดเห็นนี้ถาวร กู้คืนไม่ได้', [
      { text: 'ไม่ใช่ตอนนี้', style: 'cancel' },
      {
        text: 'ลบถาวร',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          // Deleting the comment currently being edited would otherwise leave
          // the composer in edit mode against a row that no longer exists.
          if (editingId === comment.id) cancelEdit();
          try {
            await deleteComment(comment.id);
          } catch (caught) {
            setError(formatErrorMessage(caught, 'ลบความคิดเห็นไม่สำเร็จ กรุณาลองใหม่'));
          }
        },
      },
    ]);
  };

  const openCommentMenu = (comment: Comment) => {
    Alert.alert('ความคิดเห็นของฉัน', undefined, [
      {
        text: 'แก้ไข',
        onPress: () => {
          setEditingId(comment.id);
          setDraft(comment.content);
        },
      },
      { text: 'ลบ', style: 'destructive', onPress: () => confirmDeleteComment(comment) },
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
  };

  return (
    <GradientBackground safeArea={false}>
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <SecurityHeader title="โพสต์" subject="self" />

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 56}
        >
          <FlatList
            data={comments}
            keyExtractor={(comment) => String(comment.id)}
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
            }
            ListHeaderComponent={
              <View className="pt-2">
                {post ? (
                  <PostCard
                    post={post}
                    isOwner={post.userId === userId}
                    // Already on the post — the card is the header here, not a
                    // link to somewhere else.
                    onPress={() => {}}
                    onLike={() => toggleLike(post.id)}
                    onComment={() => {}}
                  />
                ) : (
                  <MissingPost isLoading={isLoadingPost} isMissing={isMissing} />
                )}

                <ThemedText type="caption" weight="semibold" themeColor="text-secondary" className="mb-3 ml-1 mt-2 uppercase" style={{ letterSpacing: 0.5 }}>
                  {`ความคิดเห็น · ${comments.length}`}
                </ThemedText>

                {error ? (
                  <ThemedText type="small" weight="regular" themeColor="danger" accessibilityLiveRegion="polite" className="mb-3 px-1">
                    {error}
                  </ThemedText>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <ThemedText type="small" weight="regular" themeColor="text-secondary" className="px-1 pb-4">
                {isLoading ? 'กำลังโหลดความคิดเห็น…' : 'ยังไม่มีความคิดเห็น เริ่มเป็นคนแรกได้เลย'}
              </ThemedText>
            }
            renderItem={({ item }) => (
              <CommentRow
                comment={item}
                isOwner={item.userId === userId}
                isPending={editingId === item.id && isUpdating}
                onLike={() => toggleCommentLike(item.id)}
                onMore={() => openCommentMenu(item)}
              />
            )}
          />

          <View style={{ paddingBottom: insets.bottom }}>
            <CommentComposer
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                if (error) setError(null);
              }}
              onSubmit={() => void submitComment()}
              isSubmitting={isCreating || isUpdating}
              isEditing={editingId !== null}
              onCancelEdit={cancelEdit}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </GradientBackground>
  );
}

/**
 * The post is gone or still arriving. Separated because "deleted while you
 * were reading it" and "still loading" want different words — the old modal
 * simply rendered nothing and left the user looking at an empty sheet.
 */
function MissingPost({ isLoading, isMissing }: { isLoading: boolean; isMissing: boolean }) {
  const colors = useTheme();

  return (
    <View className="mb-3 rounded-2xl p-5" style={{ backgroundColor: colors.surface }}>
      <ThemedText type="body" weight="regular" themeColor="text-secondary">
        {isLoading
          ? 'กำลังโหลดโพสต์…'
          : isMissing
            ? 'โพสต์นี้ถูกลบไปแล้ว หรือไม่มีอยู่'
            : 'โหลดโพสต์ไม่สำเร็จ ลองดึงหน้าจอลงเพื่อโหลดใหม่'}
      </ThemedText>
    </View>
  );
}
