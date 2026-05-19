import { useAppStore } from '@/src/store/use-app-store';
import { CommunityPost } from '@/src/types';
import { getFontClass, getFontNumber } from '@/src/utils/font-scale';
import { toDisplayImageUri } from '@/src/utils/storage-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import React from 'react';
import { Share, Text, View } from 'react-native';
import { AnimatedPressable } from './animated-components';
import { Avatar } from './ui/avatar';
import { UIImage } from './ui/image';

cssInterop(LinearGradient, { className: 'style' });

const DEFAULT_AVATAR = require('../assets/images/icon.png');
const COLLAPSED_CONTENT_LINES = 4;
const READ_MORE_CHARACTER_THRESHOLD = 120;

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
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-[15px]',
    small: 'text-base',
    medium: 'text-[17px]',
    large: 'text-lg',
    xlarge: 'text-xl',
  });
  const bodyClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-sm',
    small: 'text-[15px]',
    medium: 'text-base',
    large: 'text-[17px]',
    xlarge: 'text-lg',
  });
  const metaClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-xs',
    small: 'text-[13px]',
    medium: 'text-sm',
    large: 'text-[15px]',
    xlarge: 'text-base',
  });
  const actionClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-[13px]',
    small: 'text-sm',
    medium: 'text-[15px]',
    large: 'text-base',
    xlarge: 'text-[17px]',
  });
  const bodyFontSize = getFontNumber(fontSizePreference, {
    xsmall: 14,
    small: 15,
    medium: 16,
    large: 17,
    xlarge: 18,
  });
  const syncLabel = post.syncStatus === 'local' ? 'บันทึกในเครื่อง' : post.syncStatus === 'pending-update' ? 'รอซิงก์' : null;
  const syncBadgeColor = post.syncStatus === 'local' ? '#FF8A45' : '#7E57C2';

  const [isExpanded, setIsExpanded] = React.useState(false);
  const [contentLineCount, setContentLineCount] = React.useState(0);
  const [hasMeasuredContent, setHasMeasuredContent] = React.useState(false);
  const avatarUri = post.userAvatar ? toDisplayImageUri(post.userAvatar) : undefined;
  const shouldShowReadMore =
    contentLineCount > COLLAPSED_CONTENT_LINES ||
    post.content.trim().length > READ_MORE_CHARACTER_THRESHOLD;

  const handleLike = () => {
    onLike?.();
  };

  React.useEffect(() => {
    setIsExpanded(false);
    setContentLineCount(0);
    setHasMeasuredContent(false);
  }, [post.id, post.content]);

  return (
    <AnimatedPressable onPress={onPress} className="mb-3 rounded-[20px] overflow-hidden shadow-lg shadow-black/10">
      <LinearGradient
        colors={isDark ? ['#0B1830', '#12243D'] : ['#FFFFFF', '#F0F7FF']}
        className={
          'p-4 rounded-[20px] border ' +
          (isDark ? 'border-[#334155]' : 'border-[#E0E7FF]')
        }
      >
        {/* Header */}
        <View className="flex-row items-center mb-3">
          <Avatar
            uri={avatarUri}
            name={post.userName}
            size="md"
            className="w-[42px] h-[42px]"
            fallback={
              <View className="w-[42px] h-[42px] rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800">
                <UIImage source={DEFAULT_AVATAR} className="w-full h-full" contentFit="cover" />
              </View>
            }
          />
          <View className="flex-1 ml-2.5">
            <Text className={(isDark ? 'text-slate-100' : 'text-[#2C3E50]') + ' ' + titleClassName + ' font-semibold'}>
              {post.userName}
            </Text>
            <Text className={(isDark ? 'text-slate-400' : 'text-gray-400') + ' ' + metaClassName + ' mt-0.5'}>
              {formatRelativeTimeTH(post.createdAt)}
            </Text>
          </View>
          {syncLabel ? (
            <View className="px-2 py-1 rounded-full mr-2" style={{ backgroundColor: isDark ? '#0B1220' : '#EEF2FF', borderWidth: 1, borderColor: syncBadgeColor }}>
              <Text style={{ color: syncBadgeColor }} className={metaClassName + " font-bold"}>
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
          className={(isDark ? 'text-slate-200' : 'text-gray-700') + ' ' + bodyClassName + ' mb-2'}
          numberOfLines={isExpanded || !hasMeasuredContent ? undefined : COLLAPSED_CONTENT_LINES}
          onTextLayout={(event) => {
            const nextLineCount = event.nativeEvent.lines.length;
            setContentLineCount((current) => (
              nextLineCount > current ? nextLineCount : current
            ));
            setHasMeasuredContent(true);
          }}
          style={{ lineHeight: bodyFontSize + 8 }}
        >
          {post.content}
        </Text>
        
        {shouldShowReadMore ? (
          <AnimatedPressable onPress={() => setIsExpanded((value) => !value)}>
            <Text className={actionClassName + " text-[#7E57C2] font-bold mb-3"}>
              {isExpanded ? 'ย่อข้อความ' : '... อ่านต่อ'}
            </Text>
          </AnimatedPressable>
        ) : null}

        {/* Actions */}
        <View
          className={
            'flex-row items-center pt-3 border-t gap-6 ' +
            (isDark ? 'border-[#334155]' : 'border-white/80')
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
                  : 'text-gray-400') + ' ' + actionClassName + ' font-medium'
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
            <Text className={(isDark ? 'text-slate-400' : 'text-gray-400') + ' ' + actionClassName + ' font-medium'}>{post.comments}</Text>
          </AnimatedPressable>

          <AnimatedPressable
            className="flex-row items-center gap-1.5"
            onPress={() => {
              void Share.share({
                message: `${post.userName}: ${post.content}`,
              }).catch(() => {});
            }}
          >
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
