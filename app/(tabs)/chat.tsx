import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
    ScrollView,
    StatusBar,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommunityPost } from '@/components/community/community-post';
import { CommunityTabs, TabType } from '@/components/community/community-tabs';
import { AppColors } from '@/constants/colors';

// Mock data
const mockPosts = [
  {
    id: '1',
    authorName: 'คุณคุณนู้',
    timeAgo: '1 นาทีที่แล้ว',
    content:
      'แค่ลิ้มไม่สุดวัยรุ่นเพียงแค่อ่าน สามารถเพิ่มกล้ามเป็น Jiren ได้ สามารถเริ่มได้โดยเข้าซิมเป็นเวลา 4 - 5 วัน และ...',
    likes: 5,
    comments: 0,
    isLiked: false,
  },
  {
    id: '2',
    authorName: 'คุณคุณนู้',
    timeAgo: '1 นาทีที่แล้ว',
    content:
      'แค่ลิ้มไม่สุดวัยรุ่นเพียงแค่อ่าน สามารถเพิ่มกล้ามเป็น Jiren ได้ สามารถเริ่มได้โดยเข้าซิมเป็นเวลา 4 - 5 วัน และ...',
    likes: 12,
    comments: 5,
    isLiked: true,
  },
  {
    id: '3',
    authorName: 'คุณคุณนู้',
    timeAgo: '1 นาทีที่แล้ว',
    content:
      'แค่ลิ้มไม่สุดวัยรุ่นเพียงแค่อ่าน สามารถเพิ่มกล้ามเป็น Jiren ได้ สามารถเริ่มได้โดยเข้าซิมเป็นเวลา 4 - 5 วัน และ...',
    likes: 12,
    comments: 5,
    isLiked: true,
  },
];

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [selectedTab, setSelectedTab] = useState<TabType>('พูดคุยทั่วไป');
  const [posts, setPosts] = useState(mockPosts);

  const handleSearch = () => {
    // TODO: Open search
    console.log('Search pressed');
  };

  const handleNotification = () => {
    // TODO: Open notifications
    console.log('Notification pressed');
  };

  const handleLike = (postId: string) => {
    setPosts((prevPosts) =>
      prevPosts.map((post) =>
        post.id === postId
          ? {
              ...post,
              isLiked: !post.isLiked,
              likes: post.isLiked ? post.likes - 1 : post.likes + 1,
            }
          : post
      )
    );
  };

  const handleComment = (postId: string) => {
    // TODO: Open comment modal
    console.log('Comment on post:', postId);
  };

  const handleReadMore = (postId: string) => {
    // TODO: Open full post
    console.log('Read more:', postId);
  };

  return (
    <View className="flex-1 bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor={AppColors.primary} />

      {/* Header */}
      <View className="bg-primary pb-2" style={{ paddingTop: insets.top + 10 }}>
        <View className="flex-row justify-between items-center px-5">
          <Text className="text-xl font-bold text-gray-800">ชุมชนสุขภาพ</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={handleSearch}
              className="w-9 h-9 rounded-full bg-white items-center justify-center"
            >
              <Ionicons name="search" size={22} color={AppColors.gray700} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleNotification}
              className="w-9 h-9 rounded-full bg-white items-center justify-center"
            >
              <Ionicons
                name="notifications-outline"
                size={22}
                color={AppColors.gray700}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View className="bg-primary">
        <CommunityTabs selectedTab={selectedTab} onSelectTab={setSelectedTab} />
      </View>

      {/* Posts */}
      <ScrollView
        className="flex-1 bg-gray-100 rounded-t-3xl"
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {posts.map((post) => (
          <CommunityPost
            key={post.id}
            id={post.id}
            authorName={post.authorName}
            timeAgo={post.timeAgo}
            content={post.content}
            likes={post.likes}
            comments={post.comments}
            isLiked={post.isLiked}
            onLike={() => handleLike(post.id)}
            onComment={() => handleComment(post.id)}
            onReadMore={() => handleReadMore(post.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
