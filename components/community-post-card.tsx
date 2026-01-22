import { CommunityPost } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { AnimatedPressable } from './animated-components';

type FirestoreTimestampLike = {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
};

function toDateSafe(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ts = value as FirestoreTimestampLike;
  if (typeof ts?.toDate === 'function') {
    const d = ts.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof ts?.seconds === 'number') {
    return new Date(ts.seconds * 1000);
  }
  return null;
}

function formatRelativeTimeTH(value: unknown): string {
  const date = toDateSafe(value);
  if (!date) return 'เมื่อสักครู่';
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return 'เมื่อสักครู่';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ชั่วโมงที่แล้ว`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} วันที่แล้ว`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return `${diffWeek} สัปดาห์ที่แล้ว`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} เดือนที่แล้ว`;
  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear} ปีที่แล้ว`;
}

interface CommunityPostCardProps {
  post: CommunityPost;
  onPress?: () => void;
  onLike?: () => void;
  onComment?: () => void;
  onMore?: () => void;
}

export const CommunityPostCard: React.FC<CommunityPostCardProps> = ({
  post,
  onPress,
  onLike,
  onComment,
  onMore,
}) => {
  const heartScale = useSharedValue(1);

  const handleLike = () => {
    heartScale.value = withSpring(1.3, { damping: 10 }, () => {
      heartScale.value = withSpring(1);
    });
    onLike?.();
  };

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  return (
    <AnimatedPressable onPress={onPress} style={styles.container}>
      <LinearGradient
        colors={['#FFFFFF', '#F0F7FF']}
        style={styles.gradient}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            {post.userAvatar ? (
              <Image 
                source={{ uri: post.userAvatar }} 
                style={styles.avatar}
              />
            ) : (
              <LinearGradient
                colors={['#5DADE2', '#3498DB']}
                style={styles.avatarPlaceholder}
              >
                <Ionicons name="person" size={18} color="white" />
              </LinearGradient>
            )}
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{post.userName}</Text>
            <Text style={styles.timeText}>{formatRelativeTimeTH(post.createdAt)}</Text>
          </View>
          <AnimatedPressable style={styles.moreButton} onPress={onMore}>
            <Ionicons name="ellipsis-horizontal" size={18} color="#9CA3AF" />
          </AnimatedPressable>
        </View>

        {/* Content */}
        <Text style={styles.content} numberOfLines={4}>
          {post.content}
        </Text>
        
        <AnimatedPressable onPress={onPress}>
          <Text style={styles.readMore}>... อ่านต่อ</Text>
        </AnimatedPressable>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <AnimatedPressable 
            onPress={handleLike}
            style={styles.actionButton}
          >
            <Animated.View style={heartAnimatedStyle}>
              <Ionicons 
                name={post.isLiked ? 'heart' : 'heart-outline'} 
                size={20} 
                color={post.isLiked ? '#E91E63' : '#9CA3AF'} 
              />
            </Animated.View>
            <Text style={[styles.actionText, post.isLiked && styles.likedText]}>
              {post.likes}
            </Text>
          </AnimatedPressable>
          
          <AnimatedPressable 
            onPress={onComment}
            style={styles.actionButton}
          >
            <Ionicons 
              name="chatbubble-outline" 
              size={18} 
              color="#9CA3AF"
            />
            <Text style={styles.actionText}>{post.comments}</Text>
          </AnimatedPressable>

          <AnimatedPressable style={styles.actionButton} onPress={() => {}}>
            <Ionicons 
              name="share-social-outline" 
              size={18} 
              color="#9CA3AF"
            />
          </AnimatedPressable>
        </View>
      </LinearGradient>
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  gradient: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
    marginLeft: 10,
  },
  userName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2C3E50',
  },
  timeText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  moreButton: {
    padding: 4,
  },
  content: {
    fontSize: 14,
    lineHeight: 22,
    color: '#4B5563',
    marginBottom: 8,
  },
  readMore: {
    fontSize: 14,
    color: '#3498DB',
    fontWeight: '500',
    marginBottom: 12,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 24,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  likedText: {
    color: '#E91E63',
  },
});

export default CommunityPostCard;
