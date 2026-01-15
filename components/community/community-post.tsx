import { AppColors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { Image, Text, TouchableOpacity, View } from 'react-native';

interface CommunityPostProps {
  id: string;
  authorName: string;
  authorAvatar?: string;
  timeAgo: string;
  content: string;
  likes: number;
  comments: number;
  isLiked?: boolean;
  onLike?: () => void;
  onComment?: () => void;
  onReadMore?: () => void;
}

export function CommunityPost({
  authorName,
  authorAvatar,
  timeAgo,
  content,
  likes,
  comments,
  isLiked = false,
  onLike,
  onComment,
  onReadMore,
}: CommunityPostProps) {
  // Truncate content if too long
  const maxLength = 100;
  const isLongContent = content.length > maxLength;
  const displayContent = isLongContent
    ? content.substring(0, maxLength) + '...'
    : content;

  return (
    <View className="bg-white rounded-2xl p-4 mx-5 mb-3 border border-gray-200">
      {/* Author Info */}
      <View className="flex-row items-center mb-3">
        {authorAvatar ? (
          <Image source={{ uri: authorAvatar }} className="w-9 h-9 rounded-full mr-2.5" />
        ) : (
          <View className="w-9 h-9 rounded-full mr-2.5 bg-primary-light items-center justify-center">
            <Ionicons name="person" size={16} color={AppColors.primary} />
          </View>
        )}
        <View className="flex-row items-center gap-[6px]">
          <Text className="text-sm font-semibold text-gray-700">{authorName}</Text>
          <Text className="text-xs text-gray-400">({timeAgo})</Text>
        </View>
      </View>

      {/* Content */}
      <Text className="text-[13px] text-gray-600 leading-5">{displayContent}</Text>

      {/* Read More */}
      {isLongContent && (
        <TouchableOpacity onPress={onReadMore}>
          <Text className="text-[13px] text-primary font-medium mt-1">... อ่านต่อ</Text>
        </TouchableOpacity>
      )}

      {/* Actions */}
      <View className="flex-row mt-3 gap-4">
        <TouchableOpacity className="flex-row items-center gap-1" onPress={onLike}>
          <Ionicons
            name={isLiked ? 'heart' : 'heart-outline'}
            size={18}
            color={isLiked ? AppColors.heartRed : AppColors.gray500}
          />
          <Text className={`text-[13px] ${isLiked ? 'text-red-500' : 'text-gray-500'}`}>
            {likes}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity className="flex-row items-center gap-1" onPress={onComment}>
          <Ionicons
            name="chatbubble-outline"
            size={16}
            color={AppColors.gray500}
          />
          <Text className="text-[13px] text-gray-500">{comments}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
