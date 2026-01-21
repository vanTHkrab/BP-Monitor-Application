import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { GradientBackground } from '@/components/gradient-background';
import { BPStatus, Colors, getBPStatus, getStatusText } from '@/constants/colors';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [cameraMountError, setCameraMountError] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [isCameraReady, setIsCameraReady] = useState(false);

  const { createReading, isAuthenticated } = useAppStore();
  
  const cameraRef = useRef<CameraView>(null);

  const retryCamera = () => {
    setCameraMountError(null);
    setIsCameraReady(false);
    setCameraKey((v) => v + 1);
  };

  if (!permission) {
    return (
      <GradientBackground>
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>กำลังโหลด...</Text>
        </View>
      </GradientBackground>
    );
  }

  if (!permission.granted) {
    return (
      <GradientBackground>
        <FadeInView delay={200}>
          <View style={styles.permissionContainer}>
            <View style={styles.permissionIconContainer}>
              <Ionicons name="camera-outline" size={64} color={Colors.primary.blue} />
            </View>
            <Text style={styles.permissionTitle}>ต้องการสิทธิ์เข้าถึงกล้อง</Text>
            <Text style={styles.permissionDesc}>
              แอปต้องการสิทธิ์ในการเข้าถึงกล้องเพื่อถ่ายภาพเครื่องวัดความดัน
            </Text>
            <CustomButton
              title="อนุญาตใช้กล้อง"
              onPress={requestPermission}
            />
          </View>
        </FadeInView>
      </GradientBackground>
    );
  }

  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          base64: true,
        });
        if (photo) {
          setCapturedImage(photo.uri);
        }
      } catch (error) {
        console.error('Error taking picture:', error);
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถถ่ายภาพได้');
      }
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
      <View style={styles.container}>
        {/* Header */}
        <LinearGradient
          colors={['#F59E0B', '#D97706', '#B45309']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.header}
        >
          <AnimatedPressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </AnimatedPressable>
          <Text style={styles.headerTitle}>ถ่ายรูปเครื่องวัดความดัน</Text>
          <View style={{ width: 40 }} />
        </LinearGradient>

        {/* Main Content */}
        {!capturedImage ? (
          <>
            <View style={styles.cameraContainer}>
              {cameraMountError ? (
                <View style={styles.cameraErrorOverlay}>
                  <View style={styles.cameraErrorCard}>
                    <Ionicons name="alert-circle" size={26} color="#DC2626" />
                    <Text style={styles.cameraErrorTitle}>กล้องใช้งานไม่ได้</Text>
                    <Text style={styles.cameraErrorDesc} numberOfLines={3}>
                      {cameraMountError}
                    </Text>
                    <View style={styles.cameraErrorActions}>
                      <AnimatedPressable onPress={retryCamera} style={styles.cameraErrorBtn}>
                        <LinearGradient colors={['#3B82F6', '#2563EB']} style={styles.cameraErrorBtnGradient}>
                          <Ionicons name="refresh" size={18} color="white" />
                          <Text style={styles.cameraErrorBtnText}>ลองใหม่</Text>
                        </LinearGradient>
                      </AnimatedPressable>
                      <AnimatedPressable
                        onPress={() => {
                          void Linking.openSettings();
                        }}
                        style={styles.cameraErrorBtn}
                      >
                        <LinearGradient colors={['#9CA3AF', '#6B7280']} style={styles.cameraErrorBtnGradient}>
                          <Ionicons name="settings" size={18} color="white" />
                          <Text style={styles.cameraErrorBtnText}>ตั้งค่า</Text>
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
                    style={StyleSheet.absoluteFillObject}
                    facing="back"
                    onMountError={(e) => {
                      // Some devices fail to mount camera; show a friendly fallback.
                      setCameraMountError(String((e as any)?.message ?? 'ไม่สามารถเปิดกล้องได้'));
                    }}
                    onCameraReady={() => setIsCameraReady(true)}
                  />

                  {!isCameraReady && (
                    <View style={styles.cameraLoadingOverlay}>
                      <View style={styles.cameraLoadingPill}>
                        <Ionicons name="time-outline" size={16} color="white" />
                        <Text style={styles.cameraLoadingText}>กำลังเปิดกล้อง...</Text>
                      </View>
                    </View>
                  )}
                </>
              )}
              
              {/* Guide Frame */}
              <View style={styles.guideContainer}>
                <ScaleOnMount delay={300}>
                  <View style={styles.guideTextContainer}>
                    <Ionicons name="scan-outline" size={18} color="white" />
                    <Text style={styles.guideText}>
                      วางหน้าจอเครื่องวัดให้ตรงกรอบ
                    </Text>
                  </View>
                </ScaleOnMount>
                <View style={styles.guideFrame}>
                  <View style={[styles.corner, styles.topLeft]} />
                  <View style={[styles.corner, styles.topRight]} />
                  <View style={[styles.corner, styles.bottomLeft]} />
                  <View style={[styles.corner, styles.bottomRight]} />
                </View>
              </View>
            </View>

            {/* Camera Controls */}
            <View style={styles.controlsWrapper}>
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.7)']}
                style={styles.controlsGradient}
              >
                <View style={styles.controlsRow}>
                  {/* Gallery Button */}
                  <AnimatedPressable onPress={pickImage} style={styles.sideButton}>
                    <View style={styles.sideButtonInner}>
                      <Ionicons name="images" size={24} color="white" />
                    </View>
                    <Text style={styles.sideButtonLabel}>แกลเลอรี่</Text>
                  </AnimatedPressable>
                  
                  {/* Capture Button - Center */}
                  <AnimatedPressable onPress={takePicture} style={styles.captureButton}>
                    <View style={styles.captureOuter}>
                      <View style={styles.captureInner}>
                        <Ionicons name="camera" size={32} color="#D97706" />
                      </View>
                    </View>
                  </AnimatedPressable>
                  
                  {/* Manual Entry Button */}
                  <AnimatedPressable onPress={openEntry} style={styles.sideButton}>
                    <View style={styles.sideButtonInner}>
                      <Ionicons name="create" size={22} color="white" />
                    </View>
                    <Text style={styles.sideButtonLabel}>กรอกค่า</Text>
                  </AnimatedPressable>
                </View>
              </LinearGradient>
            </View>
          </>
        ) : (
          <View style={styles.previewContainer}>
            <Image
              source={{ uri: capturedImage }}
              style={styles.previewImage}
              resizeMode="contain"
            />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.8)']}
              style={styles.previewControls}
            >
              <View style={styles.previewButtonsRow}>
                <AnimatedPressable onPress={resetState} style={styles.previewButton}>
                  <LinearGradient colors={['#EF4444', '#DC2626']} style={styles.previewButtonGradient}>
                    <Ionicons name="refresh" size={20} color="white" />
                    <Text style={styles.previewButtonText}>ถ่ายใหม่</Text>
                  </LinearGradient>
                </AnimatedPressable>

                <AnimatedPressable onPress={openEntry} style={styles.previewButton}>
                  <LinearGradient colors={['#3B82F6', '#2563EB']} style={styles.previewButtonGradient}>
                    <Ionicons name="checkmark" size={22} color="white" />
                    <Text style={styles.previewButtonText}>ยืนยันภาพ</Text>
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
          animationType="slide"
          onRequestClose={() => setShowEntryModal(false)}
        >
          <View style={styles.modalBackdrop}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
              style={styles.modalSheetWrapper}
            >
              <View style={styles.modalSheet}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>กรอกค่าความดัน</Text>
                  <View style={styles.modalHeaderRight}>
                    <AnimatedPressable
                      onPress={saveManualReading}
                      disabled={isSaving || !canAttemptSave}
                      style={styles.modalConfirmBtn}
                    >
                      <LinearGradient
                        colors={isSaving || !canAttemptSave ? ['#9CA3AF', '#6B7280'] : ['#22C55E', '#16A34A']}
                        style={styles.modalConfirmGradient}
                      >
                        <Ionicons name="checkmark" size={18} color="white" />
                        <Text style={styles.modalConfirmText}>{isSaving ? 'กำลังบันทึก...' : 'ยืนยัน'}</Text>
                      </LinearGradient>
                    </AnimatedPressable>

                    <AnimatedPressable onPress={() => setShowEntryModal(false)} style={styles.modalCloseBtn}>
                      <Ionicons name="close" size={22} color="#374151" />
                    </AnimatedPressable>
                  </View>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text style={styles.modalHint}>
                    {capturedImage ? 'ตรวจสอบรูปแล้วกรอกค่า SYS / DIA / ชีพจร' : 'ยังไม่มีรูป (ถ่ายรูปหรือเลือกรูปก่อน แล้วค่อยบันทึก)'}
                  </Text>

                  <View style={styles.entryRow}>
                    <View style={styles.entryCol}>
                      <CustomInput
                        placeholder="SYS"
                        value={systolic}
                        onChangeText={setSystolic}
                        icon="arrow-up"
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.entryCol}>
                      <CustomInput
                        placeholder="DIA"
                        value={diastolic}
                        onChangeText={setDiastolic}
                        icon="arrow-down"
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.entryCol}>
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

                <View style={styles.modalActionsRow}>
                  <AnimatedPressable onPress={() => setShowEntryModal(false)} style={styles.modalActionBtn}>
                    <LinearGradient colors={['#9CA3AF', '#6B7280']} style={styles.modalActionGradient}>
                      <Text style={styles.modalActionText}>ปิด</Text>
                    </LinearGradient>
                  </AnimatedPressable>

                  <AnimatedPressable
                    onPress={saveManualReading}
                    disabled={isSaving || !canAttemptSave}
                    style={styles.modalActionBtn}
                  >
                    <LinearGradient
                      colors={isSaving || !canAttemptSave ? ['#9CA3AF', '#6B7280'] : ['#22C55E', '#16A34A']}
                      style={styles.modalActionGradient}
                    >
                      <Ionicons name="save" size={18} color="white" />
                      <Text style={styles.modalActionText}>{isSaving ? 'กำลังบันทึก...' : 'บันทึก'}</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#2C3E50',
    fontSize: 16,
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionIconContainer: {
    width: 120,
    height: 120,
    backgroundColor: '#EBF5FB',
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2C3E50',
    marginBottom: 12,
  },
  permissionDesc: {
    fontSize: 16,
    color: '#7F8C8D',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  cameraLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraLoadingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  cameraLoadingText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  cameraErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  cameraErrorCard: {
    width: '100%',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    padding: 16,
    alignItems: 'center',
  },
  cameraErrorTitle: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  cameraErrorDesc: {
    marginTop: 6,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  cameraErrorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    width: '100%',
  },
  cameraErrorBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cameraErrorBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  cameraErrorBtnText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 14,
  },
  guideContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 20,
  },
  guideText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  guideFrame: {
    width: 280,
    height: 160,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#22C55E',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  controlsWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  controlsGradient: {
    paddingTop: 40,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  sideButton: {
    width: 70,
    alignItems: 'center',
  },
  sideButtonInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideButtonLabel: {
    color: 'white',
    fontSize: 12,
    marginTop: 6,
    fontWeight: '500',
  },
  captureButton: {
    alignItems: 'center',
  },
  captureOuter: {
    width: 76,
    height: 76,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  captureInner: {
    width: '100%',
    height: '100%',
    backgroundColor: 'white',
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewContainer: {
    flex: 1,
  },
  previewImage: {
    flex: 1,
  },
  previewControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  entryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  entryCol: {
    flex: 1,
  },
  previewButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  previewButton: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  previewButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    gap: 8,
  },
  previewButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 15,
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
    marginBottom: 6,
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
  modalHint: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
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
