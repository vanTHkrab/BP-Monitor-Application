import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { GradientBackground } from '@/components/gradient-background';
import { BPStatus, Colors, getBPStatus, getStatusText } from '@/constants/colors';
import { PHASE_LABEL, useCameraAnalysis } from '@/hooks/use-camera-analysis';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';

cssInterop(LinearGradient, { className: 'style' });
cssInterop(CameraView, { className: 'style' });

export default function CameraScreen() {
  // ─── Permissions ─────────────────────────────────────────────────────────────
  const [permission, requestPermission] = useCameraPermissions();

  // ─── Camera state ─────────────────────────────────────────────────────────────
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraMountError, setCameraMountError] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  // ─── Modal / form state ───────────────────────────────────────────────────────
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');

  // ─── Store ────────────────────────────────────────────────────────────────────
  const themePreference = useAppStore((s) => s.themePreference);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const isDark = themePreference === 'dark';

  // ─── Analysis service ─────────────────────────────────────────────────────────
  const { phase, prefill, error: analysisError, isSaving, analyze, save, reset: resetAnalysis } = useCameraAnalysis();

  // Auto-fill form when AI returns confident readings
  useEffect(() => {
    if (prefill.systolic) setSystolic(String(prefill.systolic));
    if (prefill.diastolic) setDiastolic(String(prefill.diastolic));
    if (prefill.pulse) setPulse(String(prefill.pulse));
  }, [prefill]);

  // ─── Derived ──────────────────────────────────────────────────────────────────
  const modalCloseIconColor = isDark ? '#E2E8F0' : '#374151';
  const canAttemptSave =
    Boolean(capturedImage) && !!systolic.trim() && !!diastolic.trim() && !!pulse.trim();
  const isAnalyzing = phase === 'uploading' || phase === 'queued' || phase === 'processing';

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  const resetAll = () => {
    setCapturedImage(null);
    setShowEntryModal(false);
    setSystolic('');
    setDiastolic('');
    setPulse('');
    resetAnalysis();
  };

  const retryCamera = () => {
    setCameraMountError(null);
    setIsCameraReady(false);
    setCameraKey((v) => v + 1);
  };

  // ─── Permission handlers ──────────────────────────────────────────────────────
  const handleRequestCameraPermission = async () => {
    try {
      if (permission?.granted) return;

      if (permission?.canAskAgain === false) {
        Alert.alert(
          'ต้องเปิดสิทธิ์กล้องจากการตั้งค่า',
          'คุณเคยปฏิเสธสิทธิ์กล้องไว้ กรุณาเปิดสิทธิ์กล้องให้แอปจากหน้าการตั้งค่า',
          [
            { text: 'ยกเลิก', style: 'cancel' },
            { text: 'เปิดการตั้งค่า', onPress: () => void Linking.openSettings() },
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
            { text: 'เปิดการตั้งค่า', onPress: () => void Linking.openSettings() },
          ],
        );
      }
    } catch {
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถขอสิทธิ์กล้องได้ในขณะนี้');
    }
  };

  // ─── Camera actions ───────────────────────────────────────────────────────────
  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.8 });
      if (!photo) return;
      setCapturedImage(photo.uri);
      void analyze(photo.uri); // kick off AI in background
    } catch {
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถถ่ายภาพได้');
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
      void analyze(result.assets[0].uri); // kick off AI in background
    }
  };

  // ─── Save handler ─────────────────────────────────────────────────────────────
  const saveReading = async () => {
    if (!isAuthenticated) {
      Alert.alert('กรุณาเข้าสู่ระบบ', 'ต้องเข้าสู่ระบบก่อนบันทึกข้อมูล');
      return;
    }

    const sys = Number(systolic);
    const dia = Number(diastolic);
    const hr = Number(pulse);

    if (
      !Number.isFinite(sys) || !Number.isFinite(dia) || !Number.isFinite(hr) ||
      sys <= 0 || dia <= 0 || hr <= 0
    ) {
      Alert.alert('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกค่า SYS / DIA / ชีพจร ให้ถูกต้อง');
      return;
    }

    if (!capturedImage) {
      Alert.alert('ไม่มีรูป', 'กรุณาถ่ายรูปหรือเลือกรูปก่อน');
      return;
    }

    try {
      const id = await save({ imageUri: capturedImage, systolic: sys, diastolic: dia, pulse: hr });

      if (!id) {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถบันทึกข้อมูลได้');
        return;
      }

      const proceed = () => { resetAll(); router.back(); };
      const status: BPStatus = getBPStatus(sys, dia);
      const statusText = getStatusText(status);

      const alertConfig: Record<BPStatus, { title: string; body: string }> = {
        normal:   { title: 'บันทึกสำเร็จ', body: 'บันทึกค่าความดันเรียบร้อยแล้ว' },
        elevated: { title: 'แจ้งเตือนความดัน', body: `ผลของคุณ: ${statusText}\n\nคำแนะนำ: พัก 5–10 นาที แล้ววัดซ้ำ 1–2 ครั้ง หากยังสูงต่อเนื่องควรปรึกษาแพทย์` },
        high:     { title: 'แจ้งเตือนความดัน', body: `ผลของคุณ: ${statusText}\n\nคำแนะนำ: หลีกเลี่ยงกิจกรรมหนัก พักและวัดซ้ำ หากมีอาการผิดปกติ ให้พบแพทย์ทันที` },
        critical: { title: 'แจ้งเตือนความดัน', body: `ผลของคุณ: ${statusText}\n\nคำแนะนำ: ควรติดต่อแพทย์/ไปโรงพยาบาลทันที` },
        low:      { title: 'บันทึกสำเร็จ', body: `ผลของคุณ: ${statusText}` },
      };

      const { title, body } = alertConfig[status] ?? alertConfig.normal;
      Alert.alert(title, body, [{ text: 'ตกลง', onPress: proceed }]);
    } catch {
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถบันทึกข้อมูลได้');
    }
  };

  // ─── Loading state ────────────────────────────────────────────────────────────
  if (!permission) {
    return (
      <GradientBackground>
        <View className="flex-1 items-center justify-center">
          <Text className={isDark ? 'text-base text-slate-200' : 'text-base text-[#2C3E50]'}>
            กำลังโหลด...
          </Text>
        </View>
      </GradientBackground>
    );
  }

  // ─── Permission gate ──────────────────────────────────────────────────────────
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
            <Text
              className={
                isDark
                  ? 'text-[22px] font-bold text-slate-200 mb-3'
                  : 'text-[22px] font-bold text-[#2C3E50] mb-3'
              }
            >
              ต้องการสิทธิ์เข้าถึงกล้อง
            </Text>
            <Text
              className={
                isDark
                  ? 'text-base text-slate-400 text-center leading-6 mb-8'
                  : 'text-base text-[#7F8C8D] text-center leading-6 mb-8'
              }
            >
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

  // ─── Main render ──────────────────────────────────────────────────────────────
  return (
    <GradientBackground safeArea={false}>
      <View className="flex-1 relative">

        {/* ── Header ── */}
        <LinearGradient
          colors={['#F59E0B', '#D97706', '#B45309']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          className={(Platform.OS === 'ios' ? 'pt-14' : 'pt-10') + ' pb-4 px-4 flex-row items-center'}
        >
          <AnimatedPressable onPress={() => router.back()} className="w-10 h-10 items-center justify-center">
            <Ionicons name="arrow-back" size={24} color="white" />
          </AnimatedPressable>
          <Text className="flex-1 text-lg font-bold text-white text-center">
            ถ่ายรูปเครื่องวัดความดัน
          </Text>
          <View className="w-10" />
        </LinearGradient>

        {/* ── Camera / Preview ── */}
        {!capturedImage ? (
          <>
            <View className="flex-1 relative">

              {/* Camera mount error fallback */}
              {cameraMountError ? (
                <View className="absolute inset-0 items-center justify-center px-5">
                  <View
                    className={
                      (isDark ? 'bg-[#0F172A]/95 border border-[#1F2937]' : 'bg-white/95') +
                      ' w-full rounded-2xl p-4 items-center'
                    }
                  >
                    <Ionicons name="alert-circle" size={26} color="#DC2626" />
                    <Text
                      className={
                        isDark
                          ? 'mt-2 text-base font-extrabold text-slate-200'
                          : 'mt-2 text-base font-extrabold text-[#111827]'
                      }
                    >
                      กล้องใช้งานไม่ได้
                    </Text>
                    <Text
                      className={
                        isDark
                          ? 'mt-1.5 text-[13px] text-slate-400 text-center'
                          : 'mt-1.5 text-[13px] text-gray-500 text-center'
                      }
                      numberOfLines={3}
                    >
                      {cameraMountError}
                    </Text>
                    <View className="flex-row space-x-2.5 mt-3 w-full">
                      <AnimatedPressable onPress={retryCamera} className="flex-1 rounded-[14px] overflow-hidden">
                        <LinearGradient
                          colors={['#3B82F6', '#2563EB']}
                          className="flex-row items-center justify-center py-3"
                        >
                          <Ionicons name="refresh" size={18} color="white" />
                          <Text className="text-white font-bold text-sm ml-2">ลองใหม่</Text>
                        </LinearGradient>
                      </AnimatedPressable>
                      <AnimatedPressable
                        onPress={() => void Linking.openSettings()}
                        className="flex-1 rounded-[14px] overflow-hidden"
                      >
                        <LinearGradient
                          colors={['#9CA3AF', '#6B7280']}
                          className="flex-row items-center justify-center py-3"
                        >
                          <Ionicons name="settings" size={18} color="white" />
                          <Text className="text-white font-bold text-sm ml-2">ตั้งค่า</Text>
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
                    onMountError={(e) =>
                      setCameraMountError(String((e as any)?.message ?? 'ไม่สามารถเปิดกล้องได้'))
                    }
                    onCameraReady={() => setIsCameraReady(true)}
                  />
                  {!isCameraReady && (
                    <View className="absolute inset-0 items-center justify-center">
                      <View className="flex-row items-center bg-black/55 px-3.5 py-2.5 rounded-full">
                        <Ionicons name="time-outline" size={16} color="white" />
                        <Text className="text-white text-[13px] font-semibold ml-2">
                          กำลังเปิดกล้อง...
                        </Text>
                      </View>
                    </View>
                  )}
                </>
              )}

              {/* Guide frame */}
              <View className="flex-1 items-center justify-center">
                <ScaleOnMount delay={300}>
                  <View className="flex-row items-center bg-black/60 px-4 py-2.5 rounded-2xl mb-5">
                    <Ionicons name="scan-outline" size={18} color="white" />
                    <Text className="text-white text-sm font-medium ml-2">
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

            {/* Camera controls */}
            <View className="absolute bottom-0 left-0 right-0">
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.7)']}
                className={(Platform.OS === 'ios' ? 'pb-10' : 'pb-6') + ' pt-10'}
              >
                <View className="flex-row justify-between items-center px-10">
                  <AnimatedPressable onPress={pickImage} className="w-[70px] items-center">
                    <View className="w-[50px] h-[50px] rounded-full bg-white/20 items-center justify-center">
                      <Ionicons name="images" size={24} color="white" />
                    </View>
                    <Text className="text-white text-xs mt-1.5 font-medium">แกลเลอรี่</Text>
                  </AnimatedPressable>

                  <AnimatedPressable onPress={takePicture} className="items-center">
                    <View className="w-[76px] h-[76px] bg-white/30 rounded-full items-center justify-center p-1">
                      <View className="w-full h-full bg-white rounded-[34px] items-center justify-center">
                        <Ionicons name="camera" size={32} color="#D97706" />
                      </View>
                    </View>
                  </AnimatedPressable>

                  <AnimatedPressable
                    onPress={() => setShowEntryModal(true)}
                    className="w-[70px] items-center"
                  >
                    <View className="w-[50px] h-[50px] rounded-full bg-white/20 items-center justify-center">
                      <Ionicons name="create" size={22} color="white" />
                    </View>
                    <Text className="text-white text-xs mt-1.5 font-medium">กรอกค่า</Text>
                  </AnimatedPressable>
                </View>
              </LinearGradient>
            </View>
          </>
        ) : (
          /* ── Image preview ── */
          <View className="flex-1">
            <Image source={{ uri: capturedImage }} className="flex-1" resizeMode="contain" />

            {/* AI analysis status badge */}
            {phase !== 'idle' && (
              <View className="absolute top-4 left-0 right-0 items-center">
                <View
                  className={
                    (phase === 'done'
                      ? 'bg-green-600/80'
                      : phase === 'failed'
                      ? 'bg-red-600/80'
                      : 'bg-black/60') + ' flex-row items-center px-4 py-2 rounded-full'
                  }
                >
                  {isAnalyzing && (
                    <Ionicons name="sync" size={14} color="white" style={{ marginRight: 6 }} />
                  )}
                  {phase === 'done' && (
                    <Ionicons name="checkmark-circle" size={14} color="white" style={{ marginRight: 6 }} />
                  )}
                  {phase === 'failed' && (
                    <Ionicons name="alert-circle" size={14} color="white" style={{ marginRight: 6 }} />
                  )}
                  <Text className="text-white text-[13px] font-semibold">
                    {PHASE_LABEL[phase]}
                  </Text>
                </View>
              </View>
            )}

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.8)']}
              className={
                (Platform.OS === 'ios' ? 'pb-10' : 'pb-6') +
                ' absolute bottom-0 left-0 right-0 px-4 py-6'
              }
            >
              <View className="flex-row justify-center space-x-3">
                <AnimatedPressable
                  onPress={resetAll}
                  className="flex-1 rounded-2xl overflow-hidden shadow-lg"
                >
                  <LinearGradient
                    colors={['#EF4444', '#DC2626']}
                    className="flex-row items-center justify-center px-6 py-3.5"
                  >
                    <Ionicons name="refresh" size={20} color="white" />
                    <Text className="text-white font-semibold text-[15px] ml-2">ถ่ายใหม่</Text>
                  </LinearGradient>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={() => setShowEntryModal(true)}
                  className="flex-1 rounded-2xl overflow-hidden shadow-lg"
                >
                  <LinearGradient
                    colors={['#3B82F6', '#2563EB']}
                    className="flex-row items-center justify-center px-6 py-3.5"
                  >
                    <Ionicons name="checkmark" size={22} color="white" />
                    <Text className="text-white font-semibold text-[15px] ml-2">ยืนยันภาพ</Text>
                  </LinearGradient>
                </AnimatedPressable>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* ── Entry Modal ── */}
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
                {/* Modal header */}
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text
                    className={
                      isDark
                        ? 'text-[17px] font-extrabold text-slate-200'
                        : 'text-[17px] font-extrabold text-[#111827]'
                    }
                  >
                    กรอกค่าความดัน
                  </Text>
                  <AnimatedPressable
                    onPress={() => setShowEntryModal(false)}
                    className={
                      (isDark ? 'bg-[#111827]' : 'bg-gray-100') +
                      ' w-9 h-9 items-center justify-center rounded-xl'
                    }
                  >
                    <Ionicons name="close" size={22} color={modalCloseIconColor} />
                  </AnimatedPressable>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {/* AI status hint */}
                  {phase !== 'idle' && (
                    <View
                      className={
                        (phase === 'done'
                          ? isDark ? 'bg-green-900/40' : 'bg-green-50'
                          : phase === 'failed'
                          ? isDark ? 'bg-red-900/40' : 'bg-red-50'
                          : isDark ? 'bg-blue-900/30' : 'bg-blue-50') +
                        ' flex-row items-center px-3 py-2 rounded-xl mb-3'
                      }
                    >
                      <Ionicons
                        name={
                          phase === 'done'
                            ? 'checkmark-circle'
                            : phase === 'failed'
                            ? 'alert-circle'
                            : 'sync'
                        }
                        size={15}
                        color={
                          phase === 'done' ? '#16A34A' : phase === 'failed' ? '#DC2626' : '#3B82F6'
                        }
                      />
                      <Text
                        className={
                          (phase === 'done'
                            ? 'text-green-700'
                            : phase === 'failed'
                            ? 'text-red-600'
                            : 'text-blue-600') + ' text-[13px] ml-2 flex-1'
                        }
                      >
                        {PHASE_LABEL[phase]}
                        {phase === 'done' && Object.keys(prefill).length > 0
                          ? ' — กรอกค่าให้อัตโนมัติแล้ว'
                          : phase === 'done'
                          ? ' — กรอกค่าด้วยตนเอง'
                          : ''}
                      </Text>
                    </View>
                  )}

                  <Text
                    className={
                      isDark
                        ? 'text-[13px] text-slate-400 mb-3'
                        : 'text-[13px] text-gray-500 mb-3'
                    }
                  >
                    {capturedImage
                      ? 'ตรวจสอบรูปแล้วกรอกค่า SYS / DIA / ชีพจร'
                      : 'ยังไม่มีรูป (ถ่ายรูปหรือเลือกรูปก่อน แล้วค่อยบันทึก)'}
                  </Text>

                  <View className="flex-row space-x-2.5">
                    <View className="flex-1">
                      <CustomInput
                        placeholder="SYS"
                        value={systolic}
                        onChangeText={setSystolic}
                        icon="arrow-up"
                        keyboardType="numeric"
                      />
                    </View>
                    <View className="flex-1">
                      <CustomInput
                        placeholder="DIA"
                        value={diastolic}
                        onChangeText={setDiastolic}
                        icon="arrow-down"
                        keyboardType="numeric"
                      />
                    </View>
                    <View className="flex-1">
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

                {/* Actions */}
                <View className="flex-row space-x-3 mt-2">
                  <AnimatedPressable
                    onPress={() => setShowEntryModal(false)}
                    className="flex-1 rounded-2xl overflow-hidden"
                  >
                    <LinearGradient
                      colors={['#9CA3AF', '#6B7280']}
                      className="flex-row items-center justify-center py-3.5"
                    >
                      <Text className="text-white font-bold text-[15px]">ปิด</Text>
                    </LinearGradient>
                  </AnimatedPressable>

                  <AnimatedPressable
                    onPress={saveReading}
                    disabled={isSaving || !canAttemptSave}
                    className="flex-1 rounded-2xl overflow-hidden"
                  >
                    <LinearGradient
                      colors={
                        isSaving || !canAttemptSave ? ['#9CA3AF', '#6B7280'] : ['#22C55E', '#16A34A']
                      }
                      className="flex-row items-center justify-center py-3.5"
                    >
                      <Ionicons name="save" size={18} color="white" />
                      <Text className="text-white font-bold text-[15px] ml-2">
                        {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                      </Text>
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