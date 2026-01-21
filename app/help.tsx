import { GradientBackground } from '@/components/gradient-background';
import { Colors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function HelpScreen() {
  const faqItems = [
    {
      question: 'วิธีการถ่ายภาพเครื่องวัดความดัน?',
      answer: 'วางเครื่องวัดความดันให้หน้าจอแสดงผลอยู่ในกรอบสี่เหลี่ยม จากนั้นกดปุ่มถ่ายภาพ แอปจะอ่านค่าจากภาพโดยอัตโนมัติ',
    },
    {
      question: 'ค่าความดันปกติอยู่ที่เท่าไหร่?',
      answer: 'ค่าความดันปกติอยู่ที่ต่ำกว่า 120/80 mmHg หากค่าความดันของคุณสูงกว่านี้ ควรปรึกษาแพทย์',
    },
    {
      question: 'ควรวัดความดันบ่อยแค่ไหน?',
      answer: 'สำหรับผู้ที่มีความดันปกติ แนะนำให้วัดอย่างน้อยปีละ 1 ครั้ง หากมีความดันสูงควรวัดทุกวันตามคำแนะนำของแพทย์',
    },
    {
      question: 'ข้อมูลของฉันปลอดภัยหรือไม่?',
      answer: 'ข้อมูลของคุณถูกเข้ารหัสและจัดเก็บอย่างปลอดภัย เราไม่แชร์ข้อมูลกับบุคคลที่สามโดยไม่ได้รับอนุญาต',
    },
  ];

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="flex-row items-center px-4 py-4">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Ionicons name="arrow-back" size={28} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-800 flex-1 text-center">ช่วยเหลือและคำแนะนำ</Text>
          <View className="w-7" />
        </View>

        {/* Contact Section */}
        <View className="px-4 mb-6">
          <Text className="text-lg font-bold text-gray-800 mb-3">ติดต่อเรา</Text>
          
          <TouchableOpacity className="flex-row items-center bg-white p-4 rounded-xl mb-3 border border-sky-200">
            <View className="w-10 h-10 bg-sky-100 rounded-full items-center justify-center mr-3">
              <Ionicons name="mail-outline" size={22} color={Colors.primary.blue} />
            </View>
            <View className="flex-1">
              <Text className="text-gray-800 font-medium">อีเมล</Text>
              <Text className="text-gray-500 text-sm">support@bpapp.com</Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity className="flex-row items-center bg-white p-4 rounded-xl mb-3 border border-sky-200">
            <View className="w-10 h-10 bg-sky-100 rounded-full items-center justify-center mr-3">
              <Ionicons name="call-outline" size={22} color={Colors.primary.blue} />
            </View>
            <View className="flex-1">
              <Text className="text-gray-800 font-medium">โทรศัพท์</Text>
              <Text className="text-gray-500 text-sm">02-123-4567</Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity className="flex-row items-center bg-white p-4 rounded-xl border border-sky-200">
            <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center mr-3">
              <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
            </View>
            <View className="flex-1">
              <Text className="text-gray-800 font-medium">Line Official</Text>
              <Text className="text-gray-500 text-sm">@bpapp</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* FAQ Section */}
        <View className="px-4">
          <Text className="text-lg font-bold text-gray-800 mb-3">คำถามที่พบบ่อย</Text>
          
          {faqItems.map((item, index) => (
            <View key={index} className="bg-white rounded-xl p-4 mb-3 border border-sky-200">
              <View className="flex-row items-start mb-2">
                <Ionicons name="help-circle" size={20} color={Colors.primary.blue} />
                <Text className="text-gray-800 font-medium ml-2 flex-1">{item.question}</Text>
              </View>
              <Text className="text-gray-600 text-sm ml-7">{item.answer}</Text>
            </View>
          ))}
        </View>

        {/* Tutorial */}
        <View className="px-4 mt-4 mb-8">
          <TouchableOpacity className="bg-purple-500 rounded-xl p-4 flex-row items-center">
            <Ionicons name="play-circle" size={32} color="white" />
            <View className="ml-3 flex-1">
              <Text className="text-white font-bold">ดูวิดีโอสอนการใช้งาน</Text>
              <Text className="text-white/80 text-sm">เรียนรู้วิธีใช้แอปอย่างละเอียด</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </GradientBackground>
  );
}
