import { GradientBackground } from '@/components/gradient-background';
import { Colors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Image, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function AboutScreen() {
  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="flex-row items-center px-4 py-4">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Ionicons name="arrow-back" size={28} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-800 flex-1 text-center">เกี่ยวกับ</Text>
          <View className="w-7" />
        </View>

        {/* App Info */}
        <View className="items-center py-8">
          <View className="w-24 h-24 bg-white rounded-2xl items-center justify-center shadow-lg mb-4">
            <Image
              source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Tux.svg/800px-Tux.svg.png' }}
              className="w-16 h-16"
              resizeMode="contain"
            />
          </View>
          <Text className="text-2xl font-bold text-gray-800">BP Monitor</Text>
          <Text className="text-gray-500">เวอร์ชัน 1.0.0</Text>
        </View>

        {/* Description */}
        <View className="px-4 mb-6">
          <View className="bg-white rounded-xl p-4 border border-sky-200">
            <Text className="text-gray-700 leading-6">
              แอปพลิเคชั่นสำหรับบันทึกและติดตามค่าความดันโลหิตของคุณ 
              ช่วยให้คุณดูแลสุขภาพได้อย่างมีประสิทธิภาพด้วยการวิเคราะห์แนวโน้ม 
              และรายงานที่เข้าใจง่าย
            </Text>
          </View>
        </View>

        {/* Features */}
        <View className="px-4 mb-6">
          <Text className="text-lg font-bold text-gray-800 mb-3">ฟีเจอร์หลัก</Text>
          
          <View className="bg-white rounded-xl p-4 border border-sky-200">
            <View className="flex-row items-center mb-3">
              <Ionicons name="camera" size={20} color={Colors.primary.blue} />
              <Text className="text-gray-700 ml-3">ถ่ายภาพเครื่องวัดความดัน</Text>
            </View>
            <View className="flex-row items-center mb-3">
              <Ionicons name="trending-up" size={20} color={Colors.primary.blue} />
              <Text className="text-gray-700 ml-3">วิเคราะห์แนวโน้มความดัน</Text>
            </View>
            <View className="flex-row items-center mb-3">
              <Ionicons name="document-text" size={20} color={Colors.primary.blue} />
              <Text className="text-gray-700 ml-3">สร้างรายงาน PDF</Text>
            </View>
            <View className="flex-row items-center mb-3">
              <Ionicons name="notifications" size={20} color={Colors.primary.blue} />
              <Text className="text-gray-700 ml-3">แจ้งเตือนวัดความดัน</Text>
            </View>
            <View className="flex-row items-center">
              <Ionicons name="people" size={20} color={Colors.primary.blue} />
              <Text className="text-gray-700 ml-3">ชุมชนแลกเปลี่ยนความรู้</Text>
            </View>
          </View>
        </View>

        {/* Links */}
        <View className="px-4 mb-6">
          <Text className="text-lg font-bold text-gray-800 mb-3">ข้อมูลเพิ่มเติม</Text>
          
          <TouchableOpacity 
            className="flex-row items-center bg-white p-4 rounded-xl mb-3 border border-sky-200"
            onPress={() => Linking.openURL('https://example.com/privacy')}
          >
            <Ionicons name="shield-outline" size={22} color={Colors.primary.blue} />
            <Text className="text-gray-700 ml-3 flex-1">นโยบายความเป็นส่วนตัว</Text>
            <Ionicons name="chevron-forward" size={20} color={Colors.text.secondary} />
          </TouchableOpacity>
          
          <TouchableOpacity 
            className="flex-row items-center bg-white p-4 rounded-xl mb-3 border border-sky-200"
            onPress={() => Linking.openURL('https://example.com/terms')}
          >
            <Ionicons name="document-outline" size={22} color={Colors.primary.blue} />
            <Text className="text-gray-700 ml-3 flex-1">เงื่อนไขการใช้งาน</Text>
            <Ionicons name="chevron-forward" size={20} color={Colors.text.secondary} />
          </TouchableOpacity>
          
          <TouchableOpacity 
            className="flex-row items-center bg-white p-4 rounded-xl border border-sky-200"
            onPress={() => Linking.openURL('https://github.com')}
          >
            <Ionicons name="logo-github" size={22} color={Colors.text.primary} />
            <Text className="text-gray-700 ml-3 flex-1">GitHub Repository</Text>
            <Ionicons name="chevron-forward" size={20} color={Colors.text.secondary} />
          </TouchableOpacity>
        </View>

        {/* Credits */}
        <View className="px-4 mb-8">
          <View className="bg-purple-50 rounded-xl p-4 border border-purple-200">
            <Text className="text-purple-800 text-center font-medium">
              พัฒนาโดย ทีมพัฒนา BP Mobile
            </Text>
            <Text className="text-purple-600 text-center text-sm mt-1">
              © 2025 All Rights Reserved
            </Text>
          </View>
        </View>
      </ScrollView>
    </GradientBackground>
  );
}
