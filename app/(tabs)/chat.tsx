import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CommunityPostCard } from '@/components/community-post-card';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/tab-buttons';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });
cssInterop(Animated.View, { className: 'style' });

type CommunityTab = 'general' | 'experience' | 'qa';

export default function CommunityScreen() {
  const { posts, toggleLike, createPost, updatePost, deletePost, isAuthenticated, user } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<CommunityTab>('general');
  const [refreshing, setRefreshing] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);

  const canSubmit = composerText.trim().length > 0 && !isPosting;

  const closeComposer = () => {
    setIsComposerOpen(false);
    setEditingPostId(null);
  };

  // FAB animation
  const fabScale = useSharedValue(1);

  React.useEffect(() => {
    fabScale.value = withRepeat(
      withSequence(
        withTiming(1.1, { duration: 1000 }),
        withTiming(1, { duration: 1000 })
      ),
      -1,
      true
    );
  }, []);

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }],
  }));

  const tabBarBaseHeight = Platform.OS === 'ios' ? 60 : 62;
  const tabBarHeight = tabBarBaseHeight + insets.bottom;
  const fabBottom = tabBarHeight + 16;

  const communityTabs = [
    { key: 'general', label: 'พูดคุยทั่วไป' },
    { key: 'experience', label: 'แชร์ประสบการณ์' },
    { key: 'qa', label: 'Q&A' }
  ];

  const filteredPosts = posts.filter(post => {
    if (activeTab === 'general') return post.category === 'general';
    if (activeTab === 'experience') return post.category === 'experience';
    if (activeTab === 'qa') return post.category === 'qa';
    return true;
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
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

  return (
    <GradientBackground>
      <ScrollView 
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <FadeInView delay={100}>
          <View className="items-center px-4 pt-3 pb-4">
            <LinearGradient
              colors={['#9B59B6', '#8E44AD']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              className="flex-row items-center px-5 py-2.5 rounded-xl shadow-lg"
            >
              <View className="mr-2">
                <Ionicons name="people" size={20} color="white" />
              </View>
              <Text className="text-lg font-bold text-white">ชุมชนสุขภาพ</Text>
            </LinearGradient>
            {/* <AnimatedPressable style={styles.notificationBtn} onPress={() => {}}>
              <Ionicons name="notifications-outline" size={24} color={Colors.primary.blue} />
            </AnimatedPressable> */}
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
                  onPress={() => {}}
                  onComment={() => {}}
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
                <Text className={isDark ? 'text-base font-semibold text-slate-200 mb-1' : 'text-base font-semibold text-[#2C3E50] mb-1'}>
                  ยังไม่มีโพสต์ในหมวดหมู่นี้
                </Text>
                <Text className={isDark ? 'text-sm text-slate-400' : 'text-sm text-[#7F8C8D]'}>
                  เป็นคนแรกที่แชร์ประสบการณ์
                </Text>
              </View>
            </ScaleOnMount>
          )}
        </View>

        {/* Bottom Spacing */}
        <View className="h-[100px]" />
      </ScrollView>

      {/* Floating Action Button */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            right: 20,
            bottom: fabBottom,
          },
          fabAnimatedStyle,
        ]}
      >
        <AnimatedPressable onPress={openComposer}>
          <LinearGradient
            colors={['#9B59B6', '#8E44AD', '#6C3483']}
            className="w-[60px] h-[60px] rounded-full items-center justify-center shadow-xl"
          >
            <Ionicons name="add" size={28} color="white" />
          </LinearGradient>
        </AnimatedPressable>
      </Animated.View>

      {/* Create Post Modal */}
      <Modal
        visible={isComposerOpen}
        transparent
        animationType="slide"
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
                <Text className={isDark ? 'text-[17px] font-extrabold text-slate-200' : 'text-[17px] font-extrabold text-[#111827]'}>
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
                      <Text className="text-white font-extrabold text-sm ml-1.5">{isPosting ? 'กำลังทำ...' : 'ยืนยัน'}</Text>
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

              <View className="flex-row space-x-2 mb-2.5">
                <AnimatedPressable
                  onPress={() => setActiveTab('general')}
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
                      'text-xs font-bold ' +
                      (isDark ? 'text-slate-400 ' : 'text-gray-500 ') +
                      (activeTab === 'general' ? (isDark ? 'text-violet-200' : 'text-violet-700') : '')
                    }
                  >
                    พูดคุยทั่วไป
                  </Text>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={() => setActiveTab('experience')}
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
                      'text-xs font-bold ' +
                      (isDark ? 'text-slate-400 ' : 'text-gray-500 ') +
                      (activeTab === 'experience' ? (isDark ? 'text-violet-200' : 'text-violet-700') : '')
                    }
                  >
                    แชร์ประสบการณ์
                  </Text>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={() => setActiveTab('qa')}
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
                      'text-xs font-bold ' +
                      (isDark ? 'text-slate-400 ' : 'text-gray-500 ') +
                      (activeTab === 'qa' ? (isDark ? 'text-violet-200' : 'text-violet-700') : '')
                    }
                  >
                    Q&A
                  </Text>
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
                  ' min-h-[120px] max-h-[220px] rounded-2xl px-3.5 py-3 text-[15px]'
                }
                textAlignVertical="top"
              />

              <View className="flex-row space-x-3 mt-3">
                <AnimatedPressable onPress={closeComposer} className="flex-1 rounded-2xl overflow-hidden">
                  <LinearGradient colors={['#9CA3AF', '#6B7280']} className="flex-row items-center justify-center py-3.5">
                    <Text className="text-white font-bold text-[15px]">ยกเลิก</Text>
                  </LinearGradient>
                </AnimatedPressable>
                <AnimatedPressable onPress={submitPost} disabled={!canSubmit} className="flex-1 rounded-2xl overflow-hidden">
                  <LinearGradient
                    colors={!canSubmit ? ['#9CA3AF', '#6B7280'] : ['#22C55E', '#16A34A']}
                    className="flex-row items-center justify-center py-3.5"
                  >
                    <Ionicons name="send" size={18} color="white" />
                    <Text className="text-white font-bold text-[15px] ml-2">{isPosting ? 'กำลังทำ...' : editingPostId ? 'ยืนยัน' : 'โพสต์'}</Text>
                  </LinearGradient>
                </AnimatedPressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </GradientBackground>
  );
}
