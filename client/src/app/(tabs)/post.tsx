/**
 * Community feed. Ported from `client-old/app/(tabs)/chat.tsx` (775 lines,
 * with two full-screen modals inside it).
 *
 * **Network-only.** client-old queued posts in SQLite (`pending_posts`),
 * drained them through a mutex, and rendered three sync-badge states on the
 * card. This tree draws the line elsewhere — `services/query-client.ts` names
 * community as cache-only data with no local mirror, and `database/schema.ts`
 * has no posts table. Porting the queue would have meant contradicting that
 * in the same change that relied on it. The trade: a post composed offline
 * fails in front of the user instead of sitting in a queue. That is the
 * failure they can act on; the silent version is what the sync-error badge
 * existed to apologise for.
 *
 * **The comment thread moved out of this file into `app/post/[id].tsx`.** It
 * was a `<Modal>` holding a scrolling list plus its own composer — a screen
 * wearing a costume. As a route it gets Android's Back gesture, and a post
 * becomes something that can be linked to.
 *
 * Kept: three category tabs, the read-more collapse, the owner-only
 * edit/delete menu. Dropped: the confirm dialog in front of posting
 * (non-destructive, and it trained people to dismiss confirmations before
 * reading them), and the Alert that fired when you opened the "…" menu on
 * someone else's post to tell you the menu did nothing — that menu simply is
 * not rendered now.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { ScreenHeaderPill } from '@/components/ui/screen-header-pill';
import { TabButtons } from '@/components/ui/tab-buttons';
import { useTheme } from '@/hooks/use-theme';
import { formatErrorMessage } from '@/lib/error-message';
import { useSession } from '@/modules/auth';
import {
  CATEGORY_TABS,
  DEFAULT_CATEGORY,
  PostCard,
  PostComposer,
  categoryLabel,
  useCreatePost,
  useDeletePost,
  usePosts,
  useToggleLike,
  useUpdatePost,
  type Post,
  type PostCategory,
} from '@/modules/community';

type ComposerState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; post: Post };

export default function CommunityScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { userId } = useSession();

  const [category, setCategory] = useState<PostCategory>(DEFAULT_CATEGORY);
  const [composer, setComposer] = useState<ComposerState>({ mode: 'closed' });
  const [error, setError] = useState<string | null>(null);

  const { posts, isLoading, isRefetching, refetch } = usePosts(category);
  const { createPost, isPending: isCreating } = useCreatePost();
  const { updatePost, isPending: isUpdating } = useUpdatePost();
  const { deletePost } = useDeletePost();
  const { toggleLike } = useToggleLike();

  const submitComposer = async (values: { content: string; category: PostCategory }) => {
    if (composer.mode === 'edit') {
      await updatePost({ id: composer.post.id, ...values });
    } else {
      await createPost(values);
      // Follow the post into the tab it landed in — otherwise a successful
      // post is followed by a feed that does not contain it.
      setCategory(values.category);
    }
    setComposer({ mode: 'closed' });
  };

  const confirmDelete = (post: Post) => {
    Alert.alert('ลบโพสต์', 'ลบโพสต์นี้ถาวร กู้คืนไม่ได้ ต้องการดำเนินการต่อหรือไม่', [
      { text: 'ไม่ใช่ตอนนี้', style: 'cancel' },
      {
        text: 'ลบถาวร',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          try {
            await deletePost(post.id);
          } catch (caught) {
            setError(formatErrorMessage(caught, 'ลบโพสต์ไม่สำเร็จ กรุณาลองใหม่'));
          }
        },
      },
    ]);
  };

  /** Only reachable from the author's own card — see `PostCard`. */
  const openOwnerMenu = (post: Post) => {
    Alert.alert('โพสต์ของฉัน', undefined, [
      { text: 'แก้ไข', onPress: () => setComposer({ mode: 'edit', post }) },
      { text: 'ลบ', style: 'destructive', onPress: () => confirmDelete(post) },
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
  };

  return (
    <GradientBackground safeArea={false}>
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        {/* `ScreenHeaderPill` — literally the same object the other two tab
            screens render, which is the only way three screens read as one
            product. This one was the odd left-aligned title before #114.

            No subtitle. The row of category tabs directly beneath already
            says what the screen is, and a line of explanatory prose above the
            control it explains is the thing this audience scrolls past. */}
        <ScreenHeaderPill title="ชุมชนสุขภาพ" />

        {/* `TabButtons`, the same control the history filters use — the two
            were structurally identical segmented rows that disagreed only on
            what "selected" looks like. `testIDPrefix` reproduces the
            `community-tab-*` ids the old component hardcoded. */}
        <View className="mb-3 px-4">
          <TabButtons
            testIDPrefix="community-tab"
            tabs={CATEGORY_TABS}
            activeTab={category}
            onTabChange={setCategory}
          />
        </View>

        {error ? (
          <ThemedText type="small" weight="regular" themeColor="danger" accessibilityLiveRegion="polite" className="mb-2 px-5">
            {error}
          </ThemedText>
        ) : null}

        <FlatList
          data={posts}
          keyExtractor={(post) => String(post.id)}
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 16,
            // Clears the tab bar plus the floating compose button above it.
            paddingBottom: insets.bottom + 140,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
          ListEmptyComponent={<EmptyFeed isLoading={isLoading} category={category} />}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              isOwner={item.userId === userId}
              onPress={() => router.push(`/post/${item.id}`)}
              onLike={() => toggleLike(item.id)}
              onComment={() => router.push(`/post/${item.id}`)}
              onMore={() => openOwnerMenu(item)}
            />
          )}
        />

        <Pressable
          testID="community-compose"
          onPress={() => setComposer({ mode: 'create' })}
          accessibilityRole="button"
          accessibilityLabel="เขียนโพสต์ใหม่"
          className="flex-row items-center rounded-full px-5 active:opacity-90"
          // Positioning lives here, not in `className`, and the `style` prop is
          // an object rather than Pressable's `({ pressed }) => …` form. Those
          // two facts are the same fact: NativeWind's interop *silently
          // discards a function `style`*. `collectInlineRules`
          // (react-native-css-interop/runtime/native/native-interop.js) walks
          // the inline prop expecting an object or an array of them, and pushes
          // a function into the rule list unchanged — where it contributes no
          // style keys and no error. The className half survives, so this
          // button kept `position: absolute` while losing `bottom`,
          // `minHeight`, and `backgroundColor`: an invisible, unanchored box
          // that Yoga parked at the top of the screen. That was C-009.
          //
          // Press feedback moves to the `active:` variant for the same reason —
          // the `pressed` callback it replaces had never once run.
          //
          // 17.5 is what `right-5` resolved to: NativeWind's native rem is 14,
          // so this is the same scale step as the `px-5` beside it, preserved
          // exactly rather than rounded to a friendlier-looking 20.
          style={{
            position: 'absolute',
            right: 17.5,
            bottom: insets.bottom + 80,
            minHeight: 56,
            backgroundColor: colors.primary,
          }}
        >
          <Ionicons name="create-outline" size={22} color="#FFFFFF" />
          <ThemedText type="body" weight="bold" className="ml-2" style={{ color: '#FFFFFF' }}>
            เขียนโพสต์
          </ThemedText>
        </Pressable>
      </View>

      {composer.mode === 'closed' ? null : (
        <PostComposer
          // Remounts per open, which is what seeds the draft from these props
          // without an effect that would set state during render.
          key={composer.mode === 'edit' ? `edit-${composer.post.id}` : 'create'}
          visible
          mode={composer.mode}
          initialContent={composer.mode === 'edit' ? composer.post.content : ''}
          initialCategory={composer.mode === 'edit' ? composer.post.category : category}
          isSubmitting={isCreating || isUpdating}
          onSubmit={submitComposer}
          onClose={() => setComposer({ mode: 'closed' })}
        />
      )}
    </GradientBackground>
  );
}

function EmptyFeed({ isLoading, category }: { isLoading: boolean; category: PostCategory }) {
  const colors = useTheme();

  return (
    <View className="mt-6 rounded-2xl p-5" style={{ backgroundColor: colors.surface }}>
      <ThemedText type="default" weight="bold">
        {isLoading ? 'กำลังโหลดโพสต์…' : `ยังไม่มีโพสต์ใน "${categoryLabel(category)}"`}
      </ThemedText>

      {isLoading ? null : (
        <ThemedText type="small" weight="regular" themeColor="text-secondary" className="mt-2">
          เป็นคนแรกที่เริ่มบทสนทนาในหมวดนี้ได้เลย
        </ThemedText>
      )}
    </View>
  );
}
