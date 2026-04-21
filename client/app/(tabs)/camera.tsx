import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { GradientBackground } from '@/components/gradient-background';
import { BPStatus, Colors, getBPStatus, getStatusText } from '@/constants/colors';
import { useAppStore } from '@/store/useAppStore';
import { getFontClass, getFontNumber } from '@/utils/font-scale';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import React, { useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, Text, View } from 'react-native';

cssInterop(LinearGradient, { className: 'style' });
cssInterop(CameraView, { className: 'style' });

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraMountError, setCameraMountError] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [isCameraReady, setIsCameraReady] = useState(false);

  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const createReading = useAppStore((s) => s.createReading);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const modalCloseIconColor = isDark ? '#E2E8F0' : '#374151';
  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-lg',
    small: 'text-xl',
    medium: 'text-[22px]',
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
  const cameraHeaderSize = getFontNumber(fontSizePreference, {
    xsmall: 16,
    small: 18,
    medium: 20,
    large: 22,
    xlarge: 24,
  });
  
  const cameraRef = useRef<CameraView>(null);

  const handleRequestCameraPermission = async () => {
    try {
      if (permission?.granted) return;

      if (permission && permission.canAskAgain === false) {
        Alert.alert(
          'ต้องเปิดสิทธิ์กล้องจากการตั้งค่า',
          'คุณเคยปฏิเสธสิทธิ์กล้องไว้ กรุณาเปิดสิทธิ์กล้องให้แอปจากหน้าการตั้งค่า',
          [
            { text: 'ยกเลิก', style: 'cancel' },
            {
              text: 'เปิดการตั้งค่า',
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        return;
      }

      const result = await requestPermission();
      if (!result.granted && result.canAskAgain === false) {
        Alert.alert(
          'ยังไม่ได้รับสิทธิ์กล้อง',
          'หากต้องการใช้งานกล้อง กรุณาอนุญาตสิทธิ์จากหน้าการตั้งค่า',
          [
            { text: 'ยกเลิก', style: 'cancel' },
            {
              text: 'เปิดการตั้งค่า',
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
      }
    } catch {
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถขอสิทธิ์กล้องได้ในขณะนี้');
    }
  };

  const retryCamera = () => {
    setCameraMountError(null);
    setIsCameraReady(false);
    setCameraKey((v) => v + 1);
  };

  if (!permission) {
    return (
      <GradientBackground>
        <View className="flex-1 items-center justify-center">
          <Text className={(isDark ? 'text-slate-200' : 'text-[#2C3E50]') + ' ' + bodyClassName}>กำลังโหลด...</Text>
        </View>
      </GradientBackground>
    );
  }

  if (!permission.granted) {
    return (
      <GradientBackground>
        <FadeInView delay={200} className="flex-1">
          <View className="flex-1 items-center justify-center px-8">
            <View
              className={
                (isDark ? 'bg-[#0F172A] border border-[#1F2937]' : 'bg-[#EBF5FB]') +
                ' w-[120px] h-[120px] rounded-full items-center justify-center mb-6'
              }
            >
              <Ionicons name="camera-outline" size={64} color={Colors.primary.blue} />
            </View>
            <Text className={(isDark ? 'text-slate-200' : 'text-[#2C3E50]') + ' ' + titleClassName + ' font-bold mb-3 text-center'}>
              ต้องการสิทธิ์เข้าถึงกล้อง
            </Text>
            <Text className={(isDark ? 'text-slate-400' : 'text-[#7F8C8D]') + ' ' + bodyClassName + ' text-center leading-6 mb-8'}>
              {permission.canAskAgain === false
                ? 'ตอนนี้แอปยังใช้กล้องไม่ได้ กรุณาเปิดสิทธิ์กล้องจากหน้าการตั้งค่า'
                : 'แอปต้องการสิทธิ์ในการเข้าถึงกล้องเพื่อถ่ายภาพเครื่องวัดความดัน'}
            </Text>
            <CustomButton
              title={permission.canAskAgain === false ? 'เปิดการตั้งค่า' : 'อนุญาตใช้กล้อง'}
              onPress={handleRequestCameraPermission}
            />
          </View>
        </FadeInView>
      </GradientBackground>
    );
  }

  const takePicture = async () => {
    if (!cameraRef.current || isCapturing || !isCameraReady || !!capturedImage) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: true,
      });
      if (photo) {
        setCapturedImage(photo.uri);
      }
    } catch (error) {
      console.error('Error taking picture:', error);
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถถ่ายภาพได้');
    } finally {
      setIsCapturing(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setCapturedImage(result.assets[0].uri);
    }
  };

  const resetState = () => {
    setCapturedImage(null);
    setShowEntryModal(false);
    setSystolic('');
    setDiastolic('');
    setPulse('');
  };

  const canAttemptSave = Boolean(capturedImage) && !!systolic.trim() && !!diastolic.trim() && !!pulse.trim();

  const openEntry = () => {
    setShowEntryModal(true);
  };

  const saveManualReading = async () => {
    if (!isAuthenticated) {
      Alert.alert('กรุณาเข้าสู่ระบบ', 'ต้องเข้าสู่ระบบก่อนบันทึกข้อมูล');
      return;
    }

    const sys = Number(systolic);
    const dia = Number(diastolic);
    const hr = Number(pulse);

    if (!Number.isFinite(sys) || !Number.isFinite(dia) || !Number.isFinite(hr) || sys <= 0 || dia <= 0 || hr <= 0) {
      Alert.alert('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกค่า SYS / DIA / ชีพจร ให้ถูกต้อง');
      return;
    }

    if (!capturedImage) {
      Alert.alert('ไม่มีรูป', 'กรุณาถ่ายรูปหรือเลือกรูปก่อน');
      return;
    }

    setIsSaving(true);
    try {
      const status: BPStatus = getBPStatus(sys, dia);
      const ok = await createReading({
        systolic: sys,
        diastolic: dia,
        pulse: hr,
        measuredAt: new Date(),
        imageUri: capturedImage,
      });

      if (ok) {
        const proceed = () => {
          resetState();
          router.back();
        };

        const statusText = getStatusText(status);
        if (status === 'normal') {
          Alert.alert('บันทึกสำเร็จ', 'บันทึกค่าความดันเรียบร้อยแล้ว', [{ text: 'ตกลง', onPress: proceed }]);
          return;
        }

        if (status === 'elevated') {
          Alert.alert(
            'แจ้งเตือนความดัน',
            `ผลของคุณ: ${statusText}\n\nคำแนะนำ: พัก 5–10 นาที แล้ววัดซ้ำ 1–2 ครั้ง หากยังสูงต่อเนื่องควรปรึกษาแพทย์`,
            [{ text: 'ตกลง', onPress: proceed }]
          );
          return;
        }

        if (status === 'high') {
          Alert.alert(
            'แจ้งเตือนความดัน',
            `ผลของคุณ: ${statusText}\n\nคำแนะนำ: หลีกเลี่ยงกิจกรรมหนัก พักและวัดซ้ำ หากมีอาการผิดปกติ (ปวดหัวมาก แน่นหน้าอก หายใจลำบาก) ให้พบแพทย์ทันที`,
            [{ text: 'ตกลง', onPress: proceed }]
          );
          return;
        }

        if (status === 'critical') {
          Alert.alert(
            'แจ้งเตือนความดัน',
            `ผลของคุณ: ${statusText}\n\nคำแนะนำ: ควรติดต่อแพทย์/ไปโรงพยาบาลทันที โดยเฉพาะหากมีอาการเวียนศีรษะ ปวดศีรษะรุนแรง ชา แขนขาอ่อนแรง หรือแน่นหน้าอก`,
            [{ text: 'ตกลง', onPress: proceed }]
          );
          return;
        }

        // low or any other status
        Alert.alert('บันทึกสำเร็จ', `ผลของคุณ: ${statusText}`, [{ text: 'ตกลง', onPress: proceed }]);
        return;
      } else {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถบันทึกข้อมูลได้');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <GradientBackground safeArea={false}>
      <View className="flex-1 relative">
        {/* Header */}
        <LinearGradient
          colors={['#F59E0B', '#D97706', '#B45309']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          className={(Platform.OS === 'ios' ? 'pt-14' : 'pt-10') + ' pb-4 px-4 flex-row items-center'}
        >
          <AnimatedPressable onPress={() => router.back()} className="w-10 h-10 items-center justify-center">
            <Ionicons name="arrow-back" size={24} color="white" />
          </AnimatedPressable>
          <Text style={{ fontSize: cameraHeaderSize, lineHeight: cameraHeaderSize + 4 }} className="flex-1 font-bold text-white text-center">
            ถ่ายรูปเครื่องวัดความดัน
          </Text>
          <View className="w-10" />
        </LinearGradient>

        {/* Main Content */}
        {!capturedImage ? (
          <>
            <View className="flex-1 relative">
              {cameraMountError ? (
                <View className="absolute inset-0 items-center justify-center px-5">
                  <View
                    className={
                      (isDark ? 'bg-[#0F172A]/95 border border-[#1F2937]' : 'bg-white/95') +
                      ' w-full rounded-2xl p-4 items-center'
                    }
                  >
                    <Ionicons name="alert-circle" size={26} color="#DC2626" />
                    <Text className={(isDark ? 'text-slate-200' : 'text-[#111827]') + ' mt-2 ' + bodyClassName + ' font-extrabold'}>
                      กล้องใช้งานไม่ได้
                    </Text>
                    <Text className={(isDark ? 'text-slate-400' : 'text-gray-500') + ' mt-1.5 ' + captionClassName + ' text-center'} numberOfLines={3}>
                      {cameraMountError}
                    </Text>
                    <View className="flex-row space-x-2.5 mt-3 w-full">
                      <AnimatedPressable onPress={retryCamera} className="flex-1 rounded-[14px] overflow-hidden">
                        <LinearGradient colors={['#3B82F6', '#2563EB']} className="flex-row items-center justify-center py-3">
                          <Ionicons name="refresh" size={18} color="white" />
                          <Text className={"text-white font-bold ml-2 " + captionClassName}>ลองใหม่</Text>
                        </LinearGradient>
                      </AnimatedPressable>
                      <AnimatedPressable
                        onPress={() => {
                          void Linking.openSettings();
                        }}
                        className="flex-1 rounded-[14px] overflow-hidden"
                      >
                        <LinearGradient colors={['#9CA3AF', '#6B7280']} className="flex-row items-center justify-center py-3">
                          <Ionicons name="settings" size={18} color="white" />
                          <Text className={"text-white font-bold ml-2 " + captionClassName}>ตั้งค่า</Text>
                        </LinearGradient>
                      </AnimatedPressable>
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  <CameraView
                    key={cameraKey}
                    ref={cameraRef}
                    className="absolute inset-0"
                    facing="back"
                    onMountError={(e) => {
                      // Some devices fail to mount camera; show a friendly fallback.
                      setCameraMountError(String((e as any)?.message ?? 'ไม่สามารถเปิดกล้องได้'));
                    }}
                    onCameraReady={() => setIsCameraReady(true)}
                  />

                  {!isCameraReady && (
                    <View className="absolute inset-0 items-center justify-center">
                      <View className="flex-row items-center bg-black/55 px-3.5 py-2.5 rounded-full">
                        <Ionicons name="time-outline" size={16} color="white" />
                        <Text className={"text-white font-semibold ml-2 " + captionClassName}>กำลังเปิดกล้อง...</Text>
                      </View>
                    </View>
                  )}
                </>
              )}
              
              {/* Guide Frame */}
              <View className="flex-1 items-center justify-center">
                <ScaleOnMount delay={300}>
                  <View className="flex-row items-center bg-black/60 px-4 py-2.5 rounded-2xl mb-5">
                    <Ionicons name="scan-outline" size={18} color="white" />
                    <Text className={"text-white font-medium ml-2 " + bodyClassName}>
                      วางหน้าจอเครื่องวัดให้ตรงกรอบ
                    </Text>
                  </View>
                </ScaleOnMount>
                <View className="w-[280px] h-[260px] relative">
                  <View className="absolute top-0 left-0 w-10 h-10 border-[#22C55E] border-t-4 border-l-4 rounded-tl-xl" />
                  <View className="absolute top-0 right-0 w-10 h-10 border-[#22C55E] border-t-4 border-r-4 rounded-tr-xl" />
                  <View className="absolute bottom-0 left-0 w-10 h-10 border-[#22C55E] border-b-4 border-l-4 rounded-bl-xl" />
                  <View className="absolute bottom-0 right-0 w-10 h-10 border-[#22C55E] border-b-4 border-r-4 rounded-br-xl" />
                </View>
              </View>
            </View>

            {/* Camera Controls */}
            <View className="absolute bottom-0 left-0 right-0">
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.7)']}
                className={(Platform.OS === 'ios' ? 'pb-10' : 'pb-6') + ' pt-10'}
              >
                <View className="flex-row justify-between items-center px-10">
                  {/* Gallery Button */}
                  <AnimatedPressable onPress={pickImage} className="w-[70px] items-center">
                    <View className="w-[50px] h-[50px] rounded-full bg-white/20 items-center justify-center">
                      <Ionicons name="images" size={24} color="white" />
                    </View>
                    <Text className={"text-white mt-1.5 font-medium " + captionClassName}>แกลเลอรี่</Text>
                  </AnimatedPressable>
                  
                  {/* Capture Button - Center */}
                  <AnimatedPressable onPress={takePicture} className="items-center" disabled={isCapturing || !isCameraReady}>
                    <View className={'w-[76px] h-[76px] rounded-full items-center justify-center p-1 ' + (isCapturing || !isCameraReady ? 'bg-white/15' : 'bg-white/30')}>
                      <View className={'w-full h-full rounded-[34px] items-center justify-center ' + (isCapturing || !isCameraReady ? 'bg-white/80' : 'bg-white')}>
                        <Ionicons name={isCapturing ? 'hourglass-outline' : 'camera'} size={32} color="#D97706" />
                      </View>
                    </View>
                    <Text className={"text-white mt-1.5 font-medium " + captionClassName}>
                      {isCapturing ? 'กำลังถ่าย...' : 'ถ่ายภาพ'}
                    </Text>
                  </AnimatedPressable>
                  
                  {/* Manual Entry Button */}
                  <AnimatedPressable onPress={openEntry} className="w-[70px] items-center">
                    <View className="w-[50px] h-[50px] rounded-full bg-white/20 items-center justify-center">
                      <Ionicons name="create" size={22} color="white" />
                    </View>
                    <Text className={"text-white mt-1.5 font-medium " + captionClassName}>กรอกค่า</Text>
                  </AnimatedPressable>
                </View>
              </LinearGradient>
            </View>
          </>
        ) : (
          <View className="flex-1">
            <Image
              source={{ uri: capturedImage }}
              className="flex-1"
              resizeMode="contain"
            />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.8)']}
              className={(Platform.OS === 'ios' ? 'pb-10' : 'pb-6') + ' absolute bottom-0 left-0 right-0 px-4 py-6'}
            >
              <View className="flex-row justify-center space-x-3">
                <AnimatedPressable onPress={resetState} className="flex-1 rounded-2xl overflow-hidden shadow-lg">
                  <LinearGradient colors={['#EF4444', '#DC2626']} className="flex-row items-center justify-center px-6 py-3.5">
                    <Ionicons name="refresh" size={20} color="white" />
                    <Text className={"text-white font-semibold ml-2 " + bodyClassName}>ถ่ายใหม่</Text>
                  </LinearGradient>
                </AnimatedPressable>

                <AnimatedPressable onPress={openEntry} className="flex-1 rounded-2xl overflow-hidden shadow-lg">
                  <LinearGradient colors={['#3B82F6', '#2563EB']} className="flex-row items-center justify-center px-6 py-3.5">
                    <Ionicons name="checkmark" size={22} color="white" />
                    <Text className={"text-white font-semibold ml-2 " + bodyClassName}>ยืนยันภาพ</Text>
                  </LinearGradient>
                </AnimatedPressable>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* Manual Entry Modal */}
        <Modal
          visible={showEntryModal}
          transparent
          animationType="none"
          onRequestClose={() => setShowEntryModal(false)}
        >
          <View className="flex-1 bg-black/45 justify-end">
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
              className="flex-1 w-full justify-end"
            >
              <View
                className={
                  (isDark ? 'bg-[#0B1220] border border-[#1F2937]' : 'bg-white') +
                  ' rounded-t-[22px] px-4 pt-3.5 ' +
                  (Platform.OS === 'ios' ? 'pb-7' : 'pb-4')
                }
              >
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text className={(isDark ? 'text-slate-200' : 'text-[#111827]') + ' ' + titleClassName + ' font-extrabold'}>
                    กรอกค่าความดัน
                  </Text>
                  <View className="flex-row items-center space-x-2.5">

                    <AnimatedPressable
                      onPress={() => setShowEntryModal(false)}
                      className={(isDark ? 'bg-[#111827]' : 'bg-gray-100') + ' w-9 h-9 items-center justify-center rounded-xl'}
                    >
                      <Ionicons name="close" size={22} color={modalCloseIconColor} />
                    </AnimatedPressable>
                  </View>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text className={(isDark ? 'text-slate-400' : 'text-gray-500') + ' mb-3 ' + captionClassName}>
                    {capturedImage ? 'ตรวจสอบรูปแล้วกรอกค่า SYS / DIA / ชีพจร' : 'ยังไม่มีรูป (ถ่ายรูปหรือเลือกรูปก่อน แล้วค่อยบันทึก)'}
                  </Text>

                  <View className="flex-col">
                    <View>
                      <CustomInput
                        placeholder="SYS"
                        value={systolic}
                        onChangeText={setSystolic}
                        icon="arrow-up"
                        keyboardType="numeric"
                      />
                    </View>
                    <View>
                      <CustomInput
                        placeholder="DIA"
                        value={diastolic}
                        onChangeText={setDiastolic}
                        icon="arrow-down"
                        keyboardType="numeric"
                      />
                    </View>
                    <View>
                      <CustomInput
                        placeholder="ชีพจร"
                        value={pulse}
                        onChangeText={setPulse}
                        icon="heart"
                        keyboardType="numeric"
                      />
                    </View>
                  </View>
                </ScrollView>

                <View className="flex-row space-x-3 mt-2">
                  <AnimatedPressable onPress={() => setShowEntryModal(false)} className="flex-1 rounded-2xl overflow-hidden">
                    <LinearGradient colors={['#9CA3AF', '#6B7280']} className="flex-row items-center justify-center py-3.5">
                      <Text className={"text-white font-bold " + bodyClassName}>ปิด</Text>
                    </LinearGradient>
                  </AnimatedPressable>

                  <AnimatedPressable
                    onPress={saveManualReading}
                    disabled={isSaving || !canAttemptSave}
                    className="flex-1 rounded-2xl overflow-hidden"
                  >
                    <LinearGradient
                      colors={isSaving || !canAttemptSave ? ['#9CA3AF', '#6B7280'] : ['#22C55E', '#16A34A']}
                      className="flex-row items-center justify-center py-3.5"
                    >
                      <Ionicons name="save" size={18} color="white" />
                      <Text className={"text-white font-bold ml-2 " + bodyClassName}>{isSaving ? 'กำลังบันทึก...' : 'บันทึก'}</Text>
                    </LinearGradient>
                  </AnimatedPressable>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      </View>
    </GradientBackground>
  );
}
