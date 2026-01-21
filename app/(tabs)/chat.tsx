import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CommunityPostCard } from '@/components/community-post-card';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/tab-buttons';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

type CommunityTab = 'general' | 'experience' | 'qa';

export default function CommunityScreen() {
  const { posts, toggleLike, createPost, updatePost, deletePost, isAuthenticated, user } = useAppStore();
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
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <FadeInView delay={100}>
          <View style={styles.header}>
            <LinearGradient
              colors={['#9B59B6', '#8E44AD']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.titleBadge}
            >
              <Ionicons name="people" size={20} color="white" style={{ marginRight: 8 }} />
              <Text style={styles.titleText}>ชุมชนสุขภาพ</Text>
            </LinearGradient>
            {/* <AnimatedPressable style={styles.notificationBtn} onPress={() => {}}>
              <Ionicons name="notifications-outline" size={24} color={Colors.primary.blue} />
            </AnimatedPressable> */}
          </View>
        </FadeInView>

        {/* Category Tabs */}
        <FadeInView delay={200}>
          <View style={styles.tabContainer}>
            <TabButtons
              tabs={communityTabs}
              activeTab={activeTab}
              onTabChange={(key) => setActiveTab(key as CommunityTab)}
              variant="pill"
            />
          </View>
        </FadeInView>

        {/* Posts */}
        <View style={styles.postsContainer}>
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
              <View style={styles.emptyState}>
                <View style={styles.emptyIconContainer}>
                  <Ionicons name="chatbubbles-outline" size={48} color="#8E44AD" />
                </View>
                <Text style={styles.emptyTitle}>ยังไม่มีโพสต์ในหมวดหมู่นี้</Text>
                <Text style={styles.emptyDesc}>เป็นคนแรกที่แชร์ประสบการณ์</Text>
              </View>
            </ScaleOnMount>
          )}
        </View>

        {/* Bottom Spacing */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating Action Button */}
      <Animated.View style={[styles.fabContainer, fabAnimatedStyle]}>
        <AnimatedPressable onPress={openComposer}>
          <LinearGradient
            colors={['#9B59B6', '#8E44AD', '#6C3483']}
            style={styles.fab}
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
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
            style={styles.modalSheetWrapper}
          >
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingPostId ? 'แก้ไขโพสต์' : 'สร้างโพสต์'}</Text>
                <View style={styles.modalHeaderRight}>
                  <AnimatedPressable
                    onPress={submitPost}
                    disabled={!canSubmit}
                    style={styles.modalConfirmBtn}
                  >
                    <LinearGradient
                      colors={!canSubmit ? ['#9CA3AF', '#6B7280'] : ['#22C55E', '#16A34A']}
                      style={styles.modalConfirmGradient}
                    >
                      <Ionicons name="checkmark" size={18} color="white" />
                      <Text style={styles.modalConfirmText}>{isPosting ? 'กำลังทำ...' : 'ยืนยัน'}</Text>
                    </LinearGradient>
                  </AnimatedPressable>

                  <AnimatedPressable onPress={closeComposer} style={styles.modalCloseBtn}>
                    <Ionicons name="close" size={22} color="#374151" />
                  </AnimatedPressable>
                </View>
              </View>

              <View style={styles.modalCategoryRow}>
                <AnimatedPressable
                  onPress={() => setActiveTab('general')}
                  style={StyleSheet.flatten([styles.categoryChip, activeTab === 'general' && styles.categoryChipActive])}
                >
                  <Text style={[styles.categoryChipText, activeTab === 'general' && styles.categoryChipTextActive]}>พูดคุยทั่วไป</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={() => setActiveTab('experience')}
                  style={StyleSheet.flatten([styles.categoryChip, activeTab === 'experience' && styles.categoryChipActive])}
                >
                  <Text style={[styles.categoryChipText, activeTab === 'experience' && styles.categoryChipTextActive]}>แชร์ประสบการณ์</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={() => setActiveTab('qa')}
                  style={StyleSheet.flatten([styles.categoryChip, activeTab === 'qa' && styles.categoryChipActive])}
                >
                  <Text style={[styles.categoryChipText, activeTab === 'qa' && styles.categoryChipTextActive]}>Q&A</Text>
                </AnimatedPressable>
              </View>

              <TextInput
                value={composerText}
                onChangeText={setComposerText}
                placeholder="พิมพ์ข้อความของคุณ..."
                placeholderTextColor="#9CA3AF"
                multiline
                style={styles.modalInput}
              />

              <View style={styles.modalActionsRow}>
                <AnimatedPressable onPress={closeComposer} style={styles.modalActionBtn}>
                  <LinearGradient colors={['#9CA3AF', '#6B7280']} style={styles.modalActionGradient}>
                    <Text style={styles.modalActionText}>ยกเลิก</Text>
                  </LinearGradient>
                </AnimatedPressable>
                <AnimatedPressable onPress={submitPost} disabled={!canSubmit} style={styles.modalActionBtn}>
                  <LinearGradient
                    colors={!canSubmit ? ['#9CA3AF', '#6B7280'] : ['#22C55E', '#16A34A']}
                    style={styles.modalActionGradient}
                  >
                    <Ionicons name="send" size={18} color="white" />
                    <Text style={styles.modalActionText}>{isPosting ? 'กำลังทำ...' : editingPostId ? 'ยืนยัน' : 'โพสต์'}</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  titleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: '#8E44AD',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  titleText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  notificationBtn: {
    position: 'absolute',
    right: 16,
    padding: 8,
  },
  tabContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  postsContainer: {
    paddingHorizontal: 16,
  },
  emptyState: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    backgroundColor: '#F3E5F5',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 14,
    color: '#7F8C8D',
  },
  fabContainer: {
    position: 'absolute',
    bottom: 100,
    right: 20,
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8E44AD',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheetWrapper: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  modalConfirmBtn: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalConfirmGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  modalConfirmText: {
    color: 'white',
    fontWeight: '800',
    fontSize: 14,
  },
  modalCategoryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  categoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  categoryChipActive: {
    backgroundColor: '#EDE9FE',
    borderColor: '#C4B5FD',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  categoryChipTextActive: {
    color: '#6D28D9',
  },
  modalInput: {
    minHeight: 120,
    maxHeight: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    textAlignVertical: 'top',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  modalActionBtn: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalActionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  modalActionText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 15,
  },
});
