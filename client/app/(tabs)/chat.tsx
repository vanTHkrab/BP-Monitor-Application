import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CommunityPostCard } from '@/components/community-post-card';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/tab-buttons';
import { useAppStore } from '@/store/use-app-store';
import { PostComment } from '@/types';
import { getFontClass, getFontNumber } from '@/utils/font-scale';
import { toDisplayImageUri } from '@/utils/storage-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import React, { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });

type CommunityTab = 'general' | 'experience' | 'qa';

export default function CommunityScreen() {
  const {
    posts,
    commentsByPostId,
    toggleLike,
    createPost,
    updatePost,
    deletePost,
    fetchPosts,
    syncPendingPosts,
    fetchPostComments,
    createComment,
    updateComment,
    deleteComment,
    toggleCommentLike,
    isAuthenticated,
    isOnline,
    authToken,
    user,
  } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<CommunityTab>('general');
  const [refreshing, setRefreshing] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);

  const canSubmit = composerText.trim().length > 0 && !isPosting;
  const selectedPost = selectedPostId
    ? posts.find((post) => post.id === selectedPostId)
    : null;
  const selectedComments = selectedPostId
    ? commentsByPostId[selectedPostId] ?? []
    : [];
  const canSubmitComment = commentText.trim().length > 0 && !isCommentSubmitting;

  const closeComposer = () => {
    setIsComposerOpen(false);
    setEditingPostId(null);
  };

  const tabBarBaseHeight = Platform.OS === 'ios' ? 60 : 62;
  const tabBarHeight = tabBarBaseHeight + insets.bottom;
  const fabBottom = tabBarHeight + 16;
  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-base',
    small: 'text-lg',
    medium: 'text-xl',
    large: 'text-2xl',
    xlarge: 'text-[28px]',
  });
  const bodyClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-xs',
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  });
  const captionClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-[11px]',
    small: 'text-xs',
    medium: 'text-sm',
    large: 'text-base',
    xlarge: 'text-lg',
  });
  const composerFontSize = getFontNumber(fontSizePreference, {
    xsmall: 13,
    small: 14,
    medium: 15,
    large: 17,
    xlarge: 19,
  });

  const communityTabs = [
    { key: 'general', label: 'พูดคุยทั่วไป' },
    { key: 'experience', label: 'แชร์ประสบการณ์' },
    { key: 'qa', label: 'Q&A' }
  ];

  useEffect(() => {
    void syncPendingPosts();
    void fetchPosts();
  }, [
    authToken,
    fetchPosts,
    isAuthenticated,
    isOnline,
    syncPendingPosts,
    user?.id,
  ]);

  const filteredPosts = posts.filter(post => {
    if (activeTab === 'general') return post.category === 'general';
    if (activeTab === 'experience') return post.category === 'experience';
    if (activeTab === 'qa') return post.category === 'qa';
    return true;
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await syncPendingPosts();
    await fetchPosts();
    if (selectedPostId) {
      await fetchPostComments(selectedPostId);
    }
    setRefreshing(false);
  };

  const openComposer = () => {
    if (!isAuthenticated) {
      Alert.alert('กรุณาเข้าสู่ระบบ', 'ต้องเข้าสู่ระบบก่อนสร้างโพสต์');
      return;
    }
    setComposerText('');
    setEditingPostId(null);
    setIsComposerOpen(true);
  };

  const openEditorForPost = (postId: string) => {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    if (!isAuthenticated || !user) {
      Alert.alert('กรุณาเข้าสู่ระบบ', 'ต้องเข้าสู่ระบบก่อนแก้ไขโพสต์');
      return;
    }
    if (post.userId !== user.id) {
      Alert.alert('ไม่สามารถแก้ไขได้', 'คุณแก้ไขได้เฉพาะโพสต์ของตัวเอง');
      return;
    }

    setActiveTab(post.category as CommunityTab);
    setComposerText(post.content);
    setEditingPostId(postId);
    setIsComposerOpen(true);
  };

  const confirmDeletePost = (postId: string) => {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    if (!isAuthenticated || !user) {
      Alert.alert('กรุณาเข้าสู่ระบบ', 'ต้องเข้าสู่ระบบก่อนลบโพสต์');
      return;
    }
    if (post.userId !== user.id) {
      Alert.alert('ไม่สามารถลบได้', 'คุณลบได้เฉพาะโพสต์ของตัวเอง');
      return;
    }

    Alert.alert('ยืนยันการลบ', 'ต้องการลบโพสต์นี้ใช่ไหม? (ลบแล้วไม่สามารถกู้คืนได้)', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ลบ',
        style: 'destructive',
        onPress: async () => {
          const ok = await deletePost(postId);
          if (!ok) Alert.alert('ข้อผิดพลาด', 'ไม่สามารถลบโพสต์ได้');
        },
      },
    ]);
  };

  const openPostActions = (postId: string) => {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    const isOwner = Boolean(user && post.userId === user.id);

    if (!isOwner) {
      Alert.alert('เมนูโพสต์', 'โพสต์ของผู้อื่นสามารถกดถูกใจ/อ่านได้เท่านั้น');
      return;
    }

    Alert.alert('จัดการโพสต์', undefined, [
      { text: 'แก้ไข', onPress: () => openEditorForPost(postId) },
      { text: 'ลบ', style: 'destructive', onPress: () => confirmDeletePost(postId) },
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
  };

  const openComments = (postId: string) => {
    setSelectedPostId(postId);
    setEditingCommentId(null);
    setCommentText('');
    void fetchPostComments(postId);
  };

  const closeComments = () => {
    setSelectedPostId(null);
    setEditingCommentId(null);
    setCommentText('');
  };

  const startEditComment = (comment: PostComment) => {
    setEditingCommentId(comment.id);
    setCommentText(comment.content);
  };

  const confirmDeleteComment = (comment: PostComment) => {
    if (!selectedPostId) return;
    Alert.alert('ลบความคิดเห็น', 'ต้องการลบความคิดเห็นนี้ใช่ไหม?', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ลบ',
        style: 'destructive',
        onPress: async () => {
          const ok = await deleteComment(selectedPostId, comment.id);
          if (!ok) Alert.alert('ข้อผิดพลาด', 'ไม่สามารถลบความคิดเห็นได้');
        },
      },
    ]);
  };

  const openCommentActions = (comment: PostComment) => {
    const isOwner = Boolean(user && comment.userId === user.id);
    if (!isOwner) return;

    Alert.alert('จัดการความคิดเห็น', undefined, [
      { text: 'แก้ไข', onPress: () => startEditComment(comment) },
      { text: 'ลบ', style: 'destructive', onPress: () => confirmDeleteComment(comment) },
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
  };

  const performCreate = async () => {
    setIsPosting(true);
    try {
      const ok = await createPost({
        content: composerText,
        category: activeTab,
      });
      if (ok) {
        closeComposer();
        setComposerText('');
      } else {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถสร้างโพสต์ได้');
      }
    } finally {
      setIsPosting(false);
    }
  };

  const performUpdate = async (postId: string) => {
    setIsPosting(true);
    try {
      const ok = await updatePost({ postId, content: composerText, category: activeTab });
      if (ok) {
        closeComposer();
        setComposerText('');
      } else {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถแก้ไขโพสต์ได้');
      }
    } finally {
      setIsPosting(false);
    }
  };

  const submitPost = () => {
    if (!composerText.trim()) {
      Alert.alert('ข้อความว่าง', 'กรุณาพิมพ์ข้อความก่อนยืนยัน');
      return;
    }

    if (editingPostId) {
      Alert.alert('ยืนยันการแก้ไข', 'ต้องการบันทึกการแก้ไขโพสต์นี้ใช่ไหม?', [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'ยืนยัน', onPress: () => void performUpdate(editingPostId) },
      ]);
      return;
    }

    Alert.alert('ยืนยันการโพสต์', 'ต้องการโพสต์ข้อความนี้ใช่ไหม?', [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ยืนยัน', onPress: () => void performCreate() },
    ]);
  };

  const submitComment = async () => {
    if (!selectedPostId) return;
    if (!isAuthenticated) {
      Alert.alert('กรุณาเข้าสู่ระบบ', 'ต้องเข้าสู่ระบบก่อนแสดงความคิดเห็น');
      return;
    }
    if (!commentText.trim()) {
      Alert.alert('ข้อความว่าง', 'กรุณาพิมพ์ความคิดเห็นก่อนส่ง');
      return;
    }

    setIsCommentSubmitting(true);
    try {
      const ok = editingCommentId
        ? await updateComment({ commentId: editingCommentId, content: commentText })
        : await createComment({ postId: selectedPostId, content: commentText });
      if (!ok) {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถบันทึกความคิดเห็นได้');
        return;
      }
      setCommentText('');
      setEditingCommentId(null);
    } finally {
      setIsCommentSubmitting(false);
    }
  };

  return (
    <GradientBackground safeArea={false}>
      <ScrollView 
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 108,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <FadeInView delay={100}>
          <View className="items-center px-4 pt-3 pb-4">
            <LinearGradient
              colors={['#FFB26B', '#FF8A45']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              className="flex-row items-center px-5 py-2.5 rounded-xl shadow-lg"
            >
              <View className="mr-2">
                <Ionicons name="people" size={20} color="white" />
              </View>
              <Text className={titleClassName + " font-bold text-white"}>ชุมชนสุขภาพ</Text>
            </LinearGradient>
          </View>
        </FadeInView>

        {/* Category Tabs */}
        <FadeInView delay={200}>
          <View className="px-4 mb-4">
            <TabButtons
              tabs={communityTabs}
              activeTab={activeTab}
              onTabChange={(key) => setActiveTab(key as CommunityTab)}
              variant="pill"
            />
          </View>
        </FadeInView>

        {/* Posts */}
        <View className="px-4">
          {filteredPosts.length > 0 ? (
            filteredPosts.map((post, index) => (
              <FadeInView key={post.id} delay={300 + index * 100}>
                <CommunityPostCard
                  post={post}
                  onLike={() => toggleLike(post.id)}
                  onMore={() => openPostActions(post.id)}
                  onPress={() => openComments(post.id)}
                  onComment={() => openComments(post.id)}
                />
              </FadeInView>
            ))
          ) : (
            <ScaleOnMount delay={300}>
              <View
                className={
                  (isDark ? 'bg-[#0F172A] border border-[#334155]' : 'bg-white') +
                  ' rounded-3xl p-8 items-center shadow-md'
                }
              >
                <View className={(isDark ? 'bg-[#1F2937]' : 'bg-[#F3E5F5]') + ' w-20 h-20 rounded-full items-center justify-center mb-4'}>
                  <Ionicons name="chatbubbles-outline" size={48} color="#8E44AD" />
                </View>
                <Text className={(isDark ? 'text-slate-200' : 'text-[#2C3E50]') + ' ' + bodyClassName + ' font-semibold mb-1 text-center'}>
                  ยังไม่มีโพสต์ในหมวดหมู่นี้
                </Text>
                <Text className={(isDark ? 'text-slate-400' : 'text-[#7F8C8D]') + ' ' + captionClassName + ' text-center'}>
                  เป็นคนแรกที่แชร์ประสบการณ์
                </Text>
              </View>
            </ScaleOnMount>
          )}
        </View>
      </ScrollView>

      {/* Floating Action Button */}
      <View className="absolute right-5" style={{ bottom: fabBottom }}>
        <AnimatedPressable onPress={openComposer}>
          <LinearGradient
            colors={['#9B59B6', '#8E44AD', '#6C3483']}
            className="w-[60px] h-[60px] rounded-full items-center justify-center shadow-xl"
          >
            <Ionicons name="add" size={28} color="white" />
          </LinearGradient>
        </AnimatedPressable>
      </View>

      {/* Create Post Modal */}
      <Modal
        visible={isComposerOpen}
        transparent
        animationType="none"
        onRequestClose={() => {
          closeComposer();
        }}
      >
        <View className="flex-1 bg-black/45 justify-end">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
            className="flex-1 w-full justify-end"
          >
            <View
              className={
                (isDark ? 'bg-[#0F172A] border-t border-[#334155]' : 'bg-white') +
                ' rounded-t-[22px] px-4 pt-3.5 ' +
                (Platform.OS === 'ios' ? 'pb-7' : 'pb-4')
              }
            >
              <View className="flex-row items-center justify-between mb-2.5">
                <Text className={(isDark ? 'text-slate-200' : 'text-[#111827]') + ' ' + titleClassName + ' font-extrabold flex-1 pr-3'}>
                  {editingPostId ? 'แก้ไขโพสต์' : 'สร้างโพสต์'}
                </Text>
                <View className="flex-row items-center space-x-2.5">
                  <AnimatedPressable
                    onPress={submitPost}
                    disabled={!canSubmit}
                    className="rounded-xl overflow-hidden"
                  >
                    <LinearGradient
                      colors={!canSubmit ? ['#9CA3AF', '#6B7280'] : ['#22C55E', '#16A34A']}
                      className="flex-row items-center justify-center px-3.5 py-2.5"
                    >
                      <Ionicons name="checkmark" size={18} color="white" />
                      <Text className={"text-white font-extrabold ml-1.5 " + captionClassName}>{isPosting ? 'กำลังทำ...' : 'ยืนยัน'}</Text>
                    </LinearGradient>
                  </AnimatedPressable>

                  <AnimatedPressable
                    onPress={closeComposer}
                    className={(isDark ? 'bg-[#111827]' : 'bg-gray-100') + ' w-9 h-9 items-center justify-center rounded-xl'}
                  >
                    <Ionicons name="close" size={22} color={isDark ? '#E2E8F0' : '#374151'} />
                  </AnimatedPressable>
                </View>
              </View>

              <View className="flex-row flex-wrap mb-2.5">
                <AnimatedPressable
                  onPress={() => setActiveTab('general')}
                  className="mr-2 mb-2"
                >
                  <View
                    className={
                      'px-2.5 py-2 rounded-full border ' +
                      (isDark ? 'bg-[#111827] border-[#334155] ' : 'bg-gray-100 border-gray-200 ') +
                      (activeTab === 'general'
                        ? (isDark ? 'bg-[#1F2937] border-[#7C3AED]' : 'bg-violet-50 border-violet-300')
                        : '')
                    }
                  >
                    <Text
                      className={
                        `${captionClassName} font-bold ` +
                        (isDark ? 'text-slate-400 ' : 'text-gray-500 ') +
                        (activeTab === 'general' ? (isDark ? 'text-violet-200' : 'text-violet-700') : '')
                      }
                    >
                      พูดคุยทั่วไป
                    </Text>
                  </View>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={() => setActiveTab('experience')}
                  className="mr-2 mb-2"
                >
                  <View
                    className={
                      'px-2.5 py-2 rounded-full border ' +
                      (isDark ? 'bg-[#111827] border-[#334155] ' : 'bg-gray-100 border-gray-200 ') +
                      (activeTab === 'experience'
                        ? (isDark ? 'bg-[#1F2937] border-[#7C3AED]' : 'bg-violet-50 border-violet-300')
                        : '')
                    }
                  >
                    <Text
                      className={
                        `${captionClassName} font-bold ` +
                        (isDark ? 'text-slate-400 ' : 'text-gray-500 ') +
                        (activeTab === 'experience' ? (isDark ? 'text-violet-200' : 'text-violet-700') : '')
                      }
                    >
                      แชร์ประสบการณ์
                    </Text>
                  </View>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={() => setActiveTab('qa')}
                  className="mr-2 mb-2"
                >
                  <View
                    className={
                      'px-2.5 py-2 rounded-full border ' +
                      (isDark ? 'bg-[#111827] border-[#334155] ' : 'bg-gray-100 border-gray-200 ') +
                      (activeTab === 'qa'
                        ? (isDark ? 'bg-[#1F2937] border-[#7C3AED]' : 'bg-violet-50 border-violet-300')
                        : '')
                    }
                  >
                    <Text
                      className={
                        `${captionClassName} font-bold ` +
                        (isDark ? 'text-slate-400 ' : 'text-gray-500 ') +
                        (activeTab === 'qa' ? (isDark ? 'text-violet-200' : 'text-violet-700') : '')
                      }
                    >
                      Q&A
                    </Text>
                  </View>
                </AnimatedPressable>
              </View>

              <TextInput
                value={composerText}
                onChangeText={setComposerText}
                placeholder="พิมพ์ข้อความของคุณ..."
                placeholderTextColor={isDark ? '#94A3B8' : '#9CA3AF'}
                multiline
                className={
                  (isDark
                    ? 'border border-[#334155] bg-[#111827] text-slate-200'
                    : 'border border-gray-200 bg-gray-50 text-[#111827]') +
                  ' min-h-[120px] max-h-[220px] rounded-2xl px-3.5 py-3'
                }
                style={{ fontSize: composerFontSize, lineHeight: composerFontSize + 8 }}
                textAlignVertical="top"
              />

              <View className="flex-row space-x-3 mt-3">
                <AnimatedPressable onPress={closeComposer} className="flex-1 rounded-2xl overflow-hidden">
                  <LinearGradient colors={['#9CA3AF', '#6B7280']} className="flex-row items-center justify-center py-3.5">
                    <Text className={"text-white font-bold " + bodyClassName}>ยกเลิก</Text>
                  </LinearGradient>
                </AnimatedPressable>
                <AnimatedPressable onPress={submitPost} disabled={!canSubmit} className="flex-1 rounded-2xl overflow-hidden">
                  <LinearGradient
                    colors={!canSubmit ? ['#9CA3AF', '#6B7280'] : ['#22C55E', '#16A34A']}
                    className="flex-row items-center justify-center py-3.5"
                  >
                    <Ionicons name="send" size={18} color="white" />
                    <Text className={"text-white font-bold ml-2 " + bodyClassName}>{isPosting ? 'กำลังทำ...' : editingPostId ? 'ยืนยัน' : 'โพสต์'}</Text>
                  </LinearGradient>
                </AnimatedPressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={Boolean(selectedPostId)}
        transparent
        animationType="fade"
        onRequestClose={closeComments}
      >
        <View className="flex-1 bg-black/45 justify-end">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
            className="w-full"
          >
            <View
              className={
                (isDark ? 'bg-[#0B1220] border-t border-[#334155]' : 'bg-white') +
                ' max-h-[86%] rounded-t-[24px] px-4 pt-4 ' +
                (Platform.OS === 'ios' ? 'pb-7' : 'pb-4')
              }
            >
              <View className="flex-row items-start justify-between mb-3">
                <View className="flex-1 pr-3">
                  <Text className={(isDark ? 'text-slate-100' : 'text-[#111827]') + ' ' + titleClassName + ' font-extrabold'}>
                    ความคิดเห็น
                  </Text>
                  <Text className={(isDark ? 'text-slate-400' : 'text-gray-500') + ' mt-1 ' + captionClassName} numberOfLines={2}>
                    {selectedPost?.content ?? 'เลือกโพสต์เพื่ออ่านความคิดเห็น'}
                  </Text>
                </View>
                <AnimatedPressable
                  onPress={closeComments}
                  className={(isDark ? 'bg-[#111827]' : 'bg-gray-100') + ' w-10 h-10 rounded-xl items-center justify-center'}
                >
                  <Ionicons name="close" size={22} color={isDark ? '#E2E8F0' : '#374151'} />
                </AnimatedPressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} className="mb-3">
                {selectedComments.length > 0 ? (
                  selectedComments.map((comment) => {
                    const isOwner = Boolean(user && comment.userId === user.id);
                    return (
                      <View
                        key={comment.id}
                        className={
                          (isDark ? 'bg-[#0F172A] border-[#334155]' : 'bg-white border-white/80') +
                          ' rounded-2xl border p-3 mb-3'
                        }
                      >
                        <View className="flex-row items-start">
                          <View className="w-10 h-10 rounded-full overflow-hidden bg-sky-100 dark:bg-slate-800 items-center justify-center mr-3">
                            {comment.userAvatar ? (
                              <Image
                                source={{ uri: toDisplayImageUri(comment.userAvatar) }}
                                className="w-full h-full"
                                resizeMode="cover"
                              />
                            ) : (
                              <Ionicons name="person" size={20} color="#7E57C2" />
                            )}
                          </View>
                          <View className="flex-1">
                            <View className="flex-row items-center justify-between">
                              <Text className={(isDark ? 'text-slate-100' : 'text-[#111827]') + ' ' + bodyClassName + ' font-bold'}>
                                {comment.userName || 'ผู้ใช้'}
                              </Text>
                              {isOwner ? (
                                <AnimatedPressable onPress={() => openCommentActions(comment)} className="p-1">
                                  <Ionicons name="ellipsis-horizontal" size={18} color={isDark ? '#94A3B8' : '#6B7280'} />
                                </AnimatedPressable>
                              ) : null}
                            </View>
                            <Text className={(isDark ? 'text-slate-300' : 'text-gray-700') + ' mt-1 leading-6 ' + bodyClassName}>
                              {comment.content}
                            </Text>
                            <View className="flex-row items-center mt-2">
                              <AnimatedPressable
                                onPress={() => selectedPostId && toggleCommentLike(selectedPostId, comment.id)}
                                className="flex-row items-center mr-4"
                              >
                                <Ionicons
                                  name={comment.isLiked ? 'heart' : 'heart-outline'}
                                  size={17}
                                  color={comment.isLiked ? '#E91E63' : isDark ? '#94A3B8' : '#6B7280'}
                                />
                                <Text className={(comment.isLiked ? 'text-[#E91E63]' : isDark ? 'text-slate-400' : 'text-gray-500') + ' ml-1 ' + captionClassName}>
                                  {comment.likes}
                                </Text>
                              </AnimatedPressable>
                              <Text className={(isDark ? 'text-slate-500' : 'text-gray-400') + ' ' + captionClassName}>
                                {new Date(comment.createdAt).toLocaleString('th-TH', {
                                  day: 'numeric',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <View className={(isDark ? 'bg-[#0F172A] border-[#334155]' : 'bg-white border-white/80') + ' rounded-2xl border p-5 items-center'}>
                    <Ionicons name="chatbubble-ellipses-outline" size={34} color="#8E44AD" />
                    <Text className={(isDark ? 'text-slate-200' : 'text-[#111827]') + ' mt-2 font-bold ' + bodyClassName}>
                      ยังไม่มีความคิดเห็น
                    </Text>
                    <Text className={(isDark ? 'text-slate-400' : 'text-gray-500') + ' mt-1 text-center ' + captionClassName}>
                      เริ่มพูดคุยจากประสบการณ์ของคุณได้เลย
                    </Text>
                  </View>
                )}
              </ScrollView>

              <View className="border-t border-gray-200 dark:border-slate-700 pt-3">
                {editingCommentId ? (
                  <View className="flex-row items-center mb-2">
                    <Text className={(isDark ? 'text-violet-200' : 'text-violet-700') + ' flex-1 font-bold ' + captionClassName}>
                      กำลังแก้ไขความคิดเห็น
                    </Text>
                    <AnimatedPressable
                      onPress={() => {
                        setEditingCommentId(null);
                        setCommentText('');
                      }}
                    >
                      <Text className={'text-[#EF4444] font-bold ' + captionClassName}>ยกเลิกแก้ไข</Text>
                    </AnimatedPressable>
                  </View>
                ) : null}
                <View className="flex-row items-end">
                  <TextInput
                    value={commentText}
                    onChangeText={setCommentText}
                    placeholder="เขียนความคิดเห็น..."
                    placeholderTextColor={isDark ? '#94A3B8' : '#9CA3AF'}
                    multiline
                    className={
                      (isDark
                        ? 'border border-[#334155] bg-[#111827] text-slate-100'
                        : 'border border-gray-200 bg-gray-50 text-[#111827]') +
                      ' flex-1 max-h-[120px] rounded-2xl px-3.5 py-3'
                    }
                    style={{ fontSize: composerFontSize, lineHeight: composerFontSize + 7 }}
                    textAlignVertical="top"
                  />
                  <AnimatedPressable
                    onPress={submitComment}
                    disabled={!canSubmitComment}
                    className="ml-2 rounded-2xl overflow-hidden"
                  >
                    <LinearGradient
                      colors={!canSubmitComment ? ['#9CA3AF', '#6B7280'] : ['#9B59B6', '#8E44AD']}
                      className="w-12 h-12 items-center justify-center"
                    >
                      <Ionicons name={isCommentSubmitting ? 'hourglass-outline' : 'send'} size={19} color="white" />
                    </LinearGradient>
                  </AnimatedPressable>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </GradientBackground>
  );
}
