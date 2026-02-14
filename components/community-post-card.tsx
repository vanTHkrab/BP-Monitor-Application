import { useAppStore } from '@/store/useAppStore';
import { CommunityPost } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import React from 'react';
import { Image, Text, View } from 'react-native';
import { AnimatedPressable } from './animated-components';

cssInterop(LinearGradient, { className: 'style' });

const DEFAULT_AVATAR = require('../assets/images/icon.png');

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
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const syncLabel = post.syncStatus === 'local' ? 'บันทึกในเครื่อง' : post.syncStatus === 'pending-update' ? 'รอซิงก์' : null;
  const syncBadgeColor = post.syncStatus === 'local' ? '#F59E0B' : '#3B82F6';

  const [avatarFailed, setAvatarFailed] = React.useState(false);
  const hasAvatarUri = Boolean(post.userAvatar) && !avatarFailed;

  const handleLike = () => {
    onLike?.();
  };

  return (
    <AnimatedPressable onPress={onPress} className="mb-3 rounded-[20px] overflow-hidden shadow-lg shadow-black/10">
      <LinearGradient
        colors={isDark ? ['#0F172A', '#111827'] : ['#FFFFFF', '#F0F7FF']}
        className={
          'p-4 rounded-[20px] border ' +
          (isDark ? 'border-[#334155]' : 'border-[#E0E7FF]')
        }
      >
        {/* Header */}
        <View className="flex-row items-center mb-3">
          <View className="w-[42px] h-[42px] rounded-full overflow-hidden">
            <Image
              source={hasAvatarUri ? { uri: post.userAvatar! } : DEFAULT_AVATAR}
              className="w-full h-full"
              resizeMode="cover"
              onError={() => setAvatarFailed(true)}
            />
          </View>
          <View className="flex-1 ml-2.5">
            <Text className={(isDark ? 'text-slate-200' : 'text-[#2C3E50]') + ' text-[15px] font-semibold'}>
              {post.userName}
            </Text>
            <Text className={(isDark ? 'text-slate-400' : 'text-gray-400') + ' text-xs mt-0.5'}>
              {formatRelativeTimeTH(post.createdAt)}
            </Text>
          </View>
          {syncLabel ? (
            <View className="px-2 py-1 rounded-full mr-2" style={{ backgroundColor: isDark ? '#0B1220' : '#EEF2FF', borderWidth: 1, borderColor: syncBadgeColor }}>
              <Text style={{ color: syncBadgeColor }} className="text-[10px] font-bold">
                {syncLabel}
              </Text>
            </View>
          ) : null}
          <AnimatedPressable className="p-1" onPress={onMore}>
            <Ionicons name="ellipsis-horizontal" size={18} color={isDark ? '#94A3B8' : '#9CA3AF'} />
          </AnimatedPressable>
        </View>

        {/* Content */}
        <Text
          className={(isDark ? 'text-slate-300' : 'text-gray-600') + ' text-sm leading-[22px] mb-2'}
          numberOfLines={4}
        >
          {post.content}
        </Text>
        
        <AnimatedPressable onPress={onPress}>
          <Text className="text-sm text-[#3498DB] font-medium mb-3">... อ่านต่อ</Text>
        </AnimatedPressable>

        {/* Actions */}
        <View
          className={
            'flex-row items-center pt-3 border-t gap-6 ' +
            (isDark ? 'border-[#334155]' : 'border-[#E5E7EB]')
          }
        >
          <AnimatedPressable 
            onPress={handleLike}
            className="flex-row items-center gap-1.5"
          >
            <View>
              <Ionicons 
                name={post.isLiked ? 'heart' : 'heart-outline'} 
                size={20} 
                color={post.isLiked ? '#E91E63' : '#9CA3AF'} 
              />
            </View>
            <Text
              className={
                (post.isLiked
                  ? 'text-[#E91E63]'
                  : isDark
                    ? 'text-slate-400'
                    : 'text-gray-400') + ' text-sm font-medium'
              }
            >
              {post.likes}
            </Text>
          </AnimatedPressable>
          
          <AnimatedPressable 
            onPress={onComment}
            className="flex-row items-center gap-1.5"
          >
            <Ionicons 
              name="chatbubble-outline" 
              size={18} 
              color={isDark ? '#94A3B8' : '#9CA3AF'}
            />
            <Text className={(isDark ? 'text-slate-400' : 'text-gray-400') + ' text-sm font-medium'}>{post.comments}</Text>
          </AnimatedPressable>

          <AnimatedPressable className="flex-row items-center gap-1.5" onPress={() => {}}>
            <Ionicons 
              name="share-social-outline" 
              size={18} 
              color={isDark ? '#94A3B8' : '#9CA3AF'}
            />
          </AnimatedPressable>
        </View>
      </LinearGradient>
    </AnimatedPressable>
  );
};

export default CommunityPostCard;
