import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { DevMetricsChip, OcrEngineSelector } from '@/components/dev-ocr-controls';
import { GradientBackground } from '@/components/gradient-background';
import { UIImage } from '@/components/ui/image';
import { BPStatus, Colors, getBPStatus, getStatusText } from '@/constants/colors';
import { LivePreflightOverlay } from '@/components/live-preflight-overlay';
import { PHASE_LABEL, useCameraAnalysis } from '@/hooks/use-camera-analysis';
import { useLivePreflight } from '@/hooks/use-live-preflight';
import { useAppStore } from '@/store/use-app-store';
import { getFontClass } from '@/utils/font-scale';
import { prepareImageForAnalysis } from '@/utils/image-prepare';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });
cssInterop(CameraView, { className: 'style' });

export default function CameraScreen() {
  // ─── Safe area ────────────────────────────────────────────────────────────────
  // Used by the header padding (so the title clears the notch / status bar)
  // and the bottom overlays (so capture / retake / confirm buttons clear the
  // home-indicator on iOS and gesture bar on Android). The (tabs) tab bar
  // is visible on this screen — the overlay bottom budget reserves the
  // tab-bar base height (60 iOS / 62 Android, mirrors _layout.tsx:43-44)
  // plus the safe-area inset plus a small breathing margin so the floating
  // capture button sits above the centre tab icon.
  const insets = useSafeAreaInsets();

  // ─── Permissions ─────────────────────────────────────────────────────────────
  const [permission, requestPermission] = useCameraPermissions();

  // ─── Camera state ─────────────────────────────────────────────────────────────
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraMountError, setCameraMountError] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  // ─── Modal / form state ───────────────────────────────────────────────────────
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');

  // ─── Store ────────────────────────────────────────────────────────────────────
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  // Dev-only OCR engine override. ``devMode`` gates the UI surfaces;
  // the hook receives ``selectedOcrEngine`` only when devMode is on so
  // production traffic preserves the gateway → ai-service default.
  const devMode = useAppStore((s) => s.devMode);
  const selectedOcrEngine = useAppStore((s) => s.selectedOcrEngine);
  const ocrEngineOverride = devMode ? selectedOcrEngine : undefined;

  // ─── Analysis service ─────────────────────────────────────────────────────────
  const {
    phase,
    prefill,
    result,
    preflight,
    isSaving,
    runPreflight,
    analyze,
    save,
    reset: resetAnalysis,
  } = useCameraAnalysis();

  // The original (uncropped) image URI captured from the camera/picker, kept
  // separately from `capturedImage` (which is what's shown in the preview —
  // the auto-cropped variant when pre-flight succeeded). On "send anyway"
  // from the warning banner we feed this URI to `analyze()` so the backend
  // still sees the full frame even when on-device thinks it's a bad shot.
  const originalImageRef = useRef<string | null>(null);

  // Live-preview overlay viewport measurement. The hook below polls
  // takePictureAsync at ~2 fps and the overlay needs the on-screen pixel
  // size of the CameraView container to map detection boxes correctly.
  const [previewViewport, setPreviewViewport] = useState<{ width: number; height: number } | null>(
    null,
  );

  // Live on-device YOLO over the camera preview. Only active when the user
  // is framing a shot — once `capturedImage` is set we switch to the static
  // preview (cropped or original) and stop the polling loop. The entry
  // modal also pauses live detection because takePictureAsync while a modal
  // is overlaid would be wasted work the user can't see.
  const isFramingShot = !capturedImage && isCameraReady && !showEntryModal;
  const liveFrame = useLivePreflight({
    cameraRef,
    enabled: isFramingShot,
    intervalMs: 500,
  });

  // Auto-fill form when AI returns confident readings.
  // Functional setState reads the *current* value at update time, so a slow
  // AI response can't overwrite characters the user typed in the meantime
  // (the closure pitfall that the previous `!systolic.trim()` check fell
  // into).
  useEffect(() => {
    if (prefill.systolic !== undefined) {
      setSystolic((prev) => (prev.trim() ? prev : String(prefill.systolic)));
    }
    if (prefill.diastolic !== undefined) {
      setDiastolic((prev) => (prev.trim() ? prev : String(prefill.diastolic)));
    }
    if (prefill.pulse !== undefined) {
      setPulse((prev) => (prev.trim() ? prev : String(prefill.pulse)));
    }
  }, [prefill]);

  // ─── Derived ──────────────────────────────────────────────────────────────────
  // Icon tints come from the app palette (Theme.* in constants/colors.ts) so
  // the camera surface reads as the same product as the home / history tabs
  // rather than a stand-alone clinical sub-app.
  const modalCloseIconColor = isDark ? '#E8E4F5' : '#374151';

  const titleClassName = getFontClass(fontSizePreference, {
      xsmall: 'text-lg',
      small: 'text-xl',
      medium: 'text-[22px]',
      large: 'text-2xl',
      xlarge: 'text-[28px]',
    });

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
  // Drop `base64: true` — the camera was emitting the full base64-encoded
  // payload on every shot just for us to discard it; only `photo.uri` is
  // actually consumed downstream. The base64 alone is ~7 MB for an iPhone
  // capture and was a real OOM hazard on lower-end Android devices.
  // Captures share the same post-resize flow: run on-device YOLO pre-flight,
  // then either auto-continue with the cropped image (status === 'ok') or
  // show a warning banner that lets the user re-shoot or send the original
  // anyway. Pre-flight failures (model load error, etc.) fall through to the
  // legacy "just analyze it" path so a bad detector load never blocks the
  // capture flow — see hooks/use-camera-analysis.ts → runPreflight().
  const startCaptureFlow = async (uri: string, width: number, height: number) => {
    // prepareImageForAnalysis may resize (long-edge cap 1600px) and returns
    // the *post-resize* dimensions. We MUST pass those to pre-flight — if
    // we pass the pre-resize dims here, YOLO would map detections back into
    // a coordinate space the file behind `prepared.uri` doesn't actually
    // live in, and the auto-crop step would then ask ImageManipulator to
    // crop a rectangle outside the image bounds (out-of-range error).
    const prepared = await prepareImageForAnalysis(uri, width, height);
    originalImageRef.current = prepared.uri;
    setCapturedImage(prepared.uri);

    const pre = await runPreflight({
      imageUri: prepared.uri,
      sourceWidth: prepared.width,
      sourceHeight: prepared.height,
    });

    if (!pre) {
      // Pre-flight failed (e.g. detector load error). Stay safe and continue
      // with backend analysis on the original.
      void analyze(prepared.uri, { ocrEngine: ocrEngineOverride });
      return;
    }

    if (pre.status === 'ok' && pre.croppedUri) {
      // Auto-crop succeeded. Use the tighter image for both the preview and
      // the upload — it's smaller (faster S3 PUT) and the backend YOLO will
      // see exactly the same crop the on-device pass agreed on.
      setCapturedImage(pre.croppedUri);
      void analyze(pre.croppedUri, { ocrEngine: ocrEngineOverride });
      return;
    }

    // status === 'no-monitor' | 'missing-fields' — leave the preview on the
    // original image and let the warning banner render (it reads
    // `preflight.status` from the hook). The user picks "ถ่ายใหม่" (reset)
    // or "ส่งต่อไป" (calls analyze on the original).
  };

  const takePicture = async () => {
    if (!cameraRef.current || isCapturing) return;
    // Tactile confirmation that the shutter actually fired — the visual
    // press feedback alone is easy to miss on cheaper Android panels.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo) return;
      await startCaptureFlow(photo.uri, photo.width, photo.height);
    } catch {
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
      const asset = result.assets[0];
      await startCaptureFlow(asset.uri, asset.width, asset.height);
    }
  };

  // Called by the "ส่งต่อไป" button in the pre-flight warning banner —
  // overrides the on-device verdict and hands the original image to the
  // backend pipeline.
  const sendAnyway = () => {
    const uri = originalImageRef.current;
    if (!uri) return;
    setCapturedImage(uri);
    void analyze(uri, { ocrEngine: ocrEngineOverride });
  };

  const retakeAfterWarning = () => {
    originalImageRef.current = null;
    setCapturedImage(null);
    resetAnalysis();
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

    // Physiologically-plausible bounds. Values outside these ranges almost
    // certainly indicate a typo or OCR misread; saving them would pollute
    // history and trigger spurious alerts.
    const SYS_MIN = 50, SYS_MAX = 250;
    const DIA_MIN = 30, DIA_MAX = 150;
    const HR_MIN = 30, HR_MAX = 220;

    if (!Number.isFinite(sys) || !Number.isFinite(dia) || !Number.isFinite(hr)) {
      Alert.alert('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกค่า SYS / DIA / ชีพจร ให้ถูกต้อง');
      return;
    }
    if (sys < SYS_MIN || sys > SYS_MAX) {
      Alert.alert('ค่า SYS ผิดปกติ', `กรุณากรอกค่า SYS ระหว่าง ${SYS_MIN}–${SYS_MAX} mmHg`);
      return;
    }
    if (dia < DIA_MIN || dia > DIA_MAX) {
      Alert.alert('ค่า DIA ผิดปกติ', `กรุณากรอกค่า DIA ระหว่าง ${DIA_MIN}–${DIA_MAX} mmHg`);
      return;
    }
    if (hr < HR_MIN || hr > HR_MAX) {
      Alert.alert('ค่าชีพจรผิดปกติ', `กรุณากรอกค่าชีพจรระหว่าง ${HR_MIN}–${HR_MAX} bpm`);
      return;
    }
    if (sys <= dia) {
      Alert.alert('ข้อมูลไม่ถูกต้อง', 'ค่า SYS ต้องมากกว่า DIA');
      return;
    }

    if (!capturedImage) {
      Alert.alert('ไม่มีรูป', 'กรุณาถ่ายรูปหรือเลือกรูปก่อน');
      return;
    }

    try {
      const ok = await save({ imageUri: capturedImage, systolic: sys, diastolic: dia, pulse: hr });

      if (!ok) {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถบันทึกข้อมูลได้');
        return;
      }

      // Dismiss the entry sheet before showing the status Alert so the alert
      // doesn't stack on top of an open modal — looks like two layers of
      // chrome to the user, especially on Android.
      setShowEntryModal(false);

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
          <Text className={isDark ? 'text-base text-[#E8E4F5]' : 'text-base text-[#2C3E50]'}>กำลังโหลด...</Text>
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
                (isDark ? 'text-[#E8E4F5]' : 'text-[#2C3E50]') +
                ' font-bold mb-3 ' +
                getFontClass(fontSizePreference, {
                  small: 'text-xl',
                  medium: 'text-2xl',
                  large: 'text-3xl',
                  xlarge: 'text-4xl',
                })
              }
            >
              ต้องการสิทธิ์เข้าถึงกล้อง
            </Text>
            <Text
              className={
                (isDark ? 'text-[#9C95C2]' : 'text-[#7F8C8D]') +
                ' text-center leading-6 mb-8 ' +
                getFontClass(fontSizePreference, {
                  small: 'text-sm',
                  medium: 'text-base',
                  large: 'text-lg',
                  xlarge: 'text-xl',
                })
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

  // ─── UI helpers ───────────────────────────────────────────────────────────────
  // Retake clears just the photo + AI state and closes the entry sheet so the
  // user lands back on the camera. The form values (SYS / DIA / HR) are
  // intentionally kept — if they already typed something, asking them to
  // re-enter it on every retake would be punishing. Use `resetAll` for the
  // hard reset (post-save / leaving the screen).
  const retake = () => {
    setCapturedImage(null);
    setShowEntryModal(false);
    resetAnalysis();
  };

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
    setCameraKey((k) => k + 1);
    setIsCameraReady(false);
  };

  const openEntry = () => setShowEntryModal(true);

  const canAttemptSave =
    Boolean(capturedImage) && !!systolic.trim() && !!diastolic.trim() && !!pulse.trim();

  // Bottom overlay padding budget. Tab bar is visible on this screen — its
  // base height (60 iOS / 62 Android) mirrors app/(tabs)/_layout.tsx:43-44.
  // We add the safe-area inset (home-indicator / gesture bar) plus 14px
  // breathing room so the 88×88 capture button clears the centre tab icon
  // without overlapping it.
  const tabBarBaseHeight = Platform.OS === 'ios' ? 60 : 62;
  const bottomOverlayPadding = tabBarBaseHeight + insets.bottom + 14;
  const captionClassName = getFontClass(fontSizePreference, {
    small: 'text-[11px]',
    medium: 'text-[13px]',
    large: 'text-[15px]',
    xlarge: 'text-[17px]',
  });
  const bodyClassName = getFontClass(fontSizePreference, {
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  });

  return (
    <GradientBackground safeArea={false}>
      <View className="flex-1 relative">

        {/* ── Header ── */}
        {/* Flat surface using the app's brand palette (Theme.* in
            constants/colors.ts) so the camera screen reads as the same
            product as the home / history tabs. Light surface = white over
            the cyan GradientBackground; dark surface = #1A1632 (Theme.dark
            .surface) with the #2D2654 border that the rest of the dark UI
            uses. Safe-area-driven top padding so the title clears the
            notch / Dynamic Island / Android edge-to-edge status bars. */}
        <View className="items-center justify-center" style={{ paddingTop: insets.top + 12, paddingBottom: 12 }}>
          <LinearGradient
            colors={['#72DDF4', '#35B8E8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            className="flex-row items-center px-5 py-2.5 rounded-xl shadow-lg"
          >
            <View className="mr-2">
              <Ionicons name="people" size={20} color="white" />
            </View>
            <Text className={titleClassName + " font-bold text-white"}>ถ่ายรูปเครื่องวัดความดัน</Text>
          </LinearGradient>
        </View>

        {/* ── Camera / Preview ── */}
        {!capturedImage ? (
          <>
            {/* Dev-only OCR engine picker — rendered in normal flow
                between the header and the camera surface so it can't be
                hidden by ``CameraView``'s native compositing (Android in
                particular ignores RN's zIndex against native surfaces).
                Hidden via the component's own ``devMode`` gate when off
                — so production users see no layout shift. */}
            <OcrEngineSelector />
            {/* Letterbox the camera surface to a strict 3:4 portrait
                viewport so the pixels the user frames match the pixels
                the on-device YOLO + backend YOLO see. The previous
                `absolute inset-0` cover-fit silently zoomed the sensor
                feed past the screen edges, so anything tracked at the
                edge of the live overlay was already off-frame in the
                captured JPEG. The outer black surface provides the
                letterbox bars on screens wider/taller than 3:4. */}
            <View className="flex-1 bg-black items-center justify-center">
              <View
                className="w-full aspect-[3/4] relative overflow-hidden"
                onLayout={(e) => {
                  const { width, height } = e.nativeEvent.layout;
                  setPreviewViewport((prev) =>
                    prev && prev.width === width && prev.height === height
                      ? prev
                      : { width, height },
                  );
                }}
              >

              {/* Camera mount error fallback — error icon stays #E74C3C
                  (Colors.status.high) since this *is* a true error state.
                  "ลองใหม่" uses the brand purple gradient (accentGradient)
                  to match primary actions elsewhere in the app; "ตั้งค่า"
                  is a neutral secondary surface. */}
              {cameraMountError ? (
                <View className="absolute inset-0 items-center justify-center px-5">
                  <View
                    className={
                      (isDark ? 'bg-[#1A1632]/95 border border-[#2D2654]' : 'bg-white/95') +
                      ' w-full rounded-2xl p-4 items-center'
                    }
                  >
                    <Ionicons name="alert-circle" size={26} color="#E74C3C" />
                    <Text className={isDark ? 'mt-2 text-base font-extrabold text-[#E8E4F5]' : 'mt-2 text-base font-extrabold text-[#2C3E50]'}>
                      กล้องใช้งานไม่ได้
                    </Text>
                    <Text className={isDark ? 'mt-1.5 text-[13px] text-[#9C95C2] text-center' : 'mt-1.5 text-[13px] text-[#7F8C8D] text-center'} numberOfLines={3}>
                      {cameraMountError}
                    </Text>
                    <View className="flex-row gap-2.5 mt-3 w-full">
                      <AnimatedPressable onPress={retryCamera} className="flex-1 rounded-[14px] overflow-hidden">
                        <LinearGradient colors={['#A879E8', '#7E57C2', '#5E35B1']} className="flex-row items-center justify-center py-3">
                          <Ionicons name="refresh" size={18} color="white" />
                          <Text className={"text-white font-bold ml-2 " + captionClassName}>ลองใหม่</Text>
                        </LinearGradient>
                      </AnimatedPressable>
                      <AnimatedPressable
                        onPress={() => void Linking.openSettings()}
                        className="flex-1 rounded-[14px] overflow-hidden"
                      >
                        <View
                          className={
                            'flex-row items-center justify-center py-3 ' +
                            (isDark ? 'bg-[#231C42] border border-[#2D2654]' : 'bg-[#EBF5FB] border border-white/80')
                          }
                        >
                          <Ionicons name="settings" size={18} color={isDark ? '#E8E4F5' : '#2C3E50'} />
                          <Text
                            className={
                              'font-bold ml-2 ' + captionClassName + ' ' +
                              (isDark ? 'text-[#E8E4F5]' : 'text-[#2C3E50]')
                            }
                          >
                            ตั้งค่า
                          </Text>
                        </View>
                      </AnimatedPressable>
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  <CameraView
                    key={cameraKey}
                    ref={cameraRef}
                    className="flex-1"
                    facing="back"
                    onMountError={(e) =>
                      setCameraMountError(e.message || 'ไม่สามารถเปิดกล้องได้')
                    }
                    onCameraReady={() => setIsCameraReady(true)}
                  />
                  {!isCameraReady && (
                    <View className="absolute inset-0 items-center justify-center">
                      <View className="flex-row items-center bg-black/55 px-3.5 py-2.5 rounded-full">
                        <Ionicons name="time-outline" size={16} color="white" />
                        <Text className="text-white text-[13px] font-semibold ml-2">กำลังเปิดกล้อง...</Text>
                      </View>
                    </View>
                  )}
                  {/* Live YOLO overlay — boxes redraw at ~2 fps. Only renders
                      while the user is framing a shot (the hook itself is
                      gated by isFramingShot). */}
                  {liveFrame && previewViewport && (
                    <LivePreflightOverlay
                      detections={liveFrame.detections}
                      pictureWidth={liveFrame.pictureWidth}
                      pictureHeight={liveFrame.pictureHeight}
                      viewportWidth={previewViewport.width}
                      viewportHeight={previewViewport.height}
                    />
                  )}
                </>
              )}

              {/* Guide frame — relative to viewport (75% width, 4:3 inner
                  box) so it scales with the letterboxed camera surface
                  instead of clipping on smaller devices. Mint corners,
                  no pulse animation — a static guide reads calmer in a
                  medical capture context. */}
              <View className="absolute inset-0 items-center justify-center pointer-events-none mb-10">
                <ScaleOnMount delay={300}>
                  <View className="flex-row items-center bg-black/60 px-4 py-2.5 rounded-2xl mb-5">
                    <Ionicons name="scan-outline" size={18} color="white" />
                    <Text className={"text-white font-medium ml-2 " + bodyClassName}>
                      วางหน้าจอเครื่องวัดให้ตรงกรอบ
                    </Text>
                  </View>
                </ScaleOnMount>
                <View className="w-[75%] aspect-[4/3] relative">
                  <View className="absolute top-0 left-0 w-10 h-10 border-[#34D399] border-t-[3px] border-l-[3px] rounded-tl-xl" />
                  <View className="absolute top-0 right-0 w-10 h-10 border-[#34D399] border-t-[3px] border-r-[3px] rounded-tr-xl" />
                  <View className="absolute bottom-0 left-0 w-10 h-10 border-[#34D399] border-b-[3px] border-l-[3px] rounded-bl-xl" />
                  <View className="absolute bottom-0 right-0 w-10 h-10 border-[#34D399] border-b-[3px] border-r-[3px] rounded-br-xl" />
                </View>
              </View>
              </View>
            </View>

            {/* Camera controls */}
            <View className="absolute bottom-0 left-0 right-0">
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.65)']}
                className="pt-10"
                style={{ paddingBottom: bottomOverlayPadding }}
              >
                <View className="flex-row justify-between items-center px-10">
                  <AnimatedPressable onPress={pickImage} className="w-[70px] items-center">
                    <View className="w-[50px] h-[50px] rounded-full bg-white/[0.12] border border-white/15 items-center justify-center">
                      <Ionicons name="images" size={22} color="white" />
                    </View>
                    <Text
                      className={
                        'text-white mt-1.5 font-medium ' +
                        getFontClass(fontSizePreference, {
                          small: 'text-[10px]',
                          medium: 'text-[11px]',
                          large: 'text-[12px]',
                          xlarge: 'text-[13px]',
                        })
                      }
                    >
                      แกลเลอรี่
                    </Text>
                  </AnimatedPressable>

                  {/* Capture Button — bold affordance: 88px outer ring +
                      72px inner white disc. Filled camera icon, slate-900
                      glyph. Haptic fires in takePicture(). Press-state
                      scale handled here via Pressable's style callback,
                      and the capturing state swaps the icon for an
                      ActivityIndicator so the user gets immediate
                      visual feedback even before the shutter resolves. */}
                  <Pressable
                    onPress={takePicture}
                    disabled={isCapturing}
                    style={({ pressed }) => ({
                      transform: [{ scale: pressed && !isCapturing ? 0.95 : 1 }],
                      alignItems: 'center',
                    })}
                  >
                    <View className="w-[88px] h-[88px] rounded-full border-[3px] border-white/40 items-center justify-center">
                      <View
                        className={
                          'w-[72px] h-[72px] rounded-full items-center justify-center ' +
                          (isCapturing ? 'bg-[#EBF5FB]' : 'bg-white')
                        }
                      >
                        {isCapturing ? (
                          <ActivityIndicator size="small" color="#5E35B1" />
                        ) : (
                          <Ionicons name="camera" size={32} color="#5E35B1" />
                        )}
                      </View>
                    </View>
                    <Text
                      className={
                        'text-white mt-1.5 font-medium text-center ' +
                        getFontClass(fontSizePreference, {
                          small: 'text-[10px]',
                          medium: 'text-[11px]',
                          large: 'text-[12px]',
                          xlarge: 'text-[13px]',
                        })
                      }
                    >
                      {isCapturing ? 'กำลังถ่าย...' : 'ถ่ายภาพ'}
                    </Text>
                  </Pressable>

                  <AnimatedPressable
                    onPress={() => setShowEntryModal(true)}
                    className="w-[70px] items-center"
                  >
                    <View className="w-[50px] h-[50px] rounded-full bg-white/[0.12] border border-white/15 items-center justify-center">
                      <Ionicons name="create" size={22} color="white" />
                    </View>
                    <Text
                      className={
                        'text-white mt-1.5 font-medium ' +
                        getFontClass(fontSizePreference, {
                          small: 'text-[10px]',
                          medium: 'text-[11px]',
                          large: 'text-[12px]',
                          xlarge: 'text-[13px]',
                        })
                      }
                    >
                      กรอกค่า
                    </Text>
                  </AnimatedPressable>
                </View>
              </LinearGradient>
            </View>
          </>
        ) : (
          /* ── Image preview ── */
          <View className="flex-1">
            <UIImage source={capturedImage} className="flex-1" contentFit="contain" />

            {/* AI analysis status badge — card lift over the preview using
                the app's surface palette (white light / #1A1632 dark). The
                phase dot reuses status colours from Colors.status (green
                normal, orange elevated, red high) and the primary brand
                cyan for in-flight phases, so the indicator language is
                shared with home / history badges. */}
            {phase !== 'idle' && (
              <View className="absolute top-4 left-0 right-0 items-center">
                <View
                  className={
                    'flex-row items-center gap-2 px-3.5 py-2 rounded-full border ' +
                    (isDark
                      ? 'bg-[#1A1632] border-[#2D2654] shadow-lg shadow-black/40'
                      : 'bg-white border-[#EBF5FB] shadow-lg shadow-black/15')
                  }
                >
                  <View
                    className={
                      'w-2 h-2 rounded-full ' +
                      (phase === 'done'
                        ? 'bg-[#27AE60]'
                        : phase === 'failed'
                        ? 'bg-[#E74C3C]'
                        : phase === 'queued'
                        ? 'bg-[#F39C12]'
                        : 'bg-[#35B8E8]')
                    }
                  />
                  <Text
                    className={
                      'text-[13px] font-semibold ' +
                      (isDark ? 'text-[#E8E4F5]' : 'text-[#2C3E50]')
                    }
                  >
                    {PHASE_LABEL[phase]}
                  </Text>
                </View>
                {/* Dev-only telemetry chip — hidden in production. */}
                <DevMetricsChip
                  engine={result?.engine}
                  totalMs={result?.metrics?.totalMs}
                  rssDeltaMb={result?.metrics?.rssDeltaMb}
                />
              </View>
            )}

            {/* On-device pre-flight warning banner. Shows when the bundled
                YOLO disagrees with the captured image AND either we haven't
                kicked off analyse yet (`idle`) OR the backend pass already
                failed (`failed`) — in the latter case the on-device verdict
                is the only diagnostic the user has, so keep it visible.
                Hidden while the backend is uploading / queued / processing
                so it doesn't compete with the status chip above. Sits at
                top-24 so it always renders *below* the status badge at top-4
                rather than overlapping it on the failed-phase frame. */}
            {(phase === 'idle' || phase === 'failed') && preflight && preflight.status !== 'ok' && (
              /* Warning surface uses Colors.status.elevated (#F39C12) — the
                 same orange the status badge and home-screen elevated chip
                 use, so warning language is consistent across the app.
                 Override action ("ส่งต่อไป") uses the brand accent purple
                 gradient (Theme.light.accentGradient) — primary action
                 colour throughout the redesigned surface. */
              <View
                className="absolute top-24 left-4 right-4 rounded-2xl border px-4 py-3 shadow-lg shadow-black/20"
                style={{ backgroundColor: 'rgba(243,156,18,0.95)', borderColor: 'rgba(217,119,6,0.45)' }}
              >
                <View className="flex-row items-center mb-2">
                  <Ionicons
                    name="alert-circle"
                    size={20}
                    color="#7A3E00"
                    style={{ marginRight: 8 }}
                  />
                  <Text className={'font-semibold ' + bodyClassName} style={{ color: '#3A1F00' }}>
                    {preflight.status === 'no-monitor'
                      ? 'ไม่เจอ BP monitor'
                      : 'ภาพไม่ชัดหรือไกลเกินไป'}
                  </Text>
                </View>
                <Text className={'mb-3 ' + captionClassName} style={{ color: 'rgba(58,31,0,0.92)' }}>
                  {preflight.status === 'no-monitor'
                    ? 'ลองถ่ายใหม่ให้เห็นเครื่องวัดทั้งหน้าจอ หรือกด "ส่งต่อไป" ถ้าต้องการให้ AI ตรวจสอบ'
                    : `ตรวจไม่พบค่า ${preflight.missingFields.join(' / ')} ลองถ่ายใหม่ให้ใกล้และชัดขึ้น`}
                </Text>
                <View className="flex-row gap-2">
                  <AnimatedPressable
                    onPress={retakeAfterWarning}
                    className="flex-1 rounded-xl overflow-hidden"
                  >
                    <View
                      className="px-3 py-2 items-center border"
                      style={{ backgroundColor: '#FFF4E0', borderColor: 'rgba(217,119,6,0.45)' }}
                    >
                      <Text className={'font-semibold ' + captionClassName} style={{ color: '#3A1F00' }}>
                        ถ่ายใหม่
                      </Text>
                    </View>
                  </AnimatedPressable>
                  <AnimatedPressable
                    onPress={sendAnyway}
                    className="flex-1 rounded-xl overflow-hidden"
                  >
                    <LinearGradient
                      colors={['#A879E8', '#7E57C2', '#5E35B1']}
                      className="px-3 py-2 items-center"
                    >
                      <Text className={'text-white font-semibold ' + captionClassName}>
                        ส่งต่อไป
                      </Text>
                    </LinearGradient>
                  </AnimatedPressable>
                </View>
              </View>
            )}

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.8)']}
              className="absolute bottom-0 left-0 right-0 px-4 pt-6"
              // Reserve space for the home-indicator / gesture bar — the
              // (tabs) tab bar is hidden on this screen (see _layout.tsx)
              // so we only need the safe-area inset plus breathing room
              // so the retake / confirm row stays reachable.
              style={{ paddingBottom: bottomOverlayPadding }}
            >
              {/* Retake = neutral brand-dark surface (Theme.dark.surfaceMuted
                  reads as a calm neutral over the photo without screaming
                  destructive). Confirm = brand accent purple gradient — the
                  primary-action language shared with the rest of the app. */}
              <View className="flex-row justify-center gap-3">
                <AnimatedPressable
                  onPress={retake}
                  className="flex-1 rounded-2xl overflow-hidden shadow-lg"
                >
                  <View
                    className="flex-row items-center justify-center px-5 py-3.5 border"
                    style={{ backgroundColor: '#231C42', borderColor: '#2D2654' }}
                  >
                    <Ionicons name="refresh" size={20} color="#E8E4F5" />
                    <Text className={"font-semibold ml-2 " + bodyClassName} style={{ color: '#E8E4F5' }}>ถ่ายใหม่</Text>
                  </View>
                </AnimatedPressable>

                <AnimatedPressable onPress={openEntry} className="flex-1 rounded-2xl overflow-hidden shadow-lg">
                  <LinearGradient
                    colors={['#A879E8', '#7E57C2', '#5E35B1']}
                    className="flex-row items-center justify-center px-5 py-3.5"
                  >
                    <Ionicons name="checkmark" size={22} color="white" />
                    <Text className={"text-white font-semibold ml-2 " + bodyClassName}>ยืนยันภาพ</Text>
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
          {/* Tap-on-scrim dismisses the sheet (standard bottom-sheet UX).
              The inner sheet captures touches via its own Pressable so taps
              inside the form don't bubble back up and close the modal. */}
          <Pressable
            onPress={() => setShowEntryModal(false)}
            className="flex-1 bg-black/45 justify-end"
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={Platform.OS === 'ios' ? insets.bottom + 10 : 0}
              className="flex-1 w-full justify-end"
            >
              <Pressable
                onPress={() => { /* swallow — tap inside sheet must not dismiss */ }}
                className={
                  (isDark ? 'bg-[#1A1632] border border-[#2D2654]' : 'bg-white') +
                  ' rounded-t-[22px] px-4 pt-2.5 ' +
                  (Platform.OS === 'ios' ? 'pb-7' : 'pb-4')
                }
              >
                {/* Drag handle — bottom-sheet affordance signalling the
                    sheet is dismissible via the scrim above. Static (no
                    gesture wiring) — the tap-on-scrim path already covers
                    dismissal; this is purely a visual cue. */}
                <View className="items-center mb-2">
                  <View
                    className={
                      'w-10 h-1 rounded-full ' +
                      (isDark ? 'bg-[#2D2654]' : 'bg-[#CFE3EE]')
                    }
                  />
                </View>

                {/* Modal header — semibold (not extrabold) keeps the
                    clinical/calm register established by the rest of the
                    redesigned surface. */}
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text
                    className={
                      'font-semibold ' +
                      (isDark ? 'text-[#E8E4F5]' : 'text-[#2C3E50]') +
                      ' ' +
                      getFontClass(fontSizePreference, {
                        small: 'text-base',
                        medium: 'text-[17px]',
                        large: 'text-lg',
                        xlarge: 'text-xl',
                      })
                    }
                  >
                    กรอกค่าความดัน
                  </Text>
                  <AnimatedPressable
                    onPress={() => setShowEntryModal(false)}
                    className={
                      (isDark ? 'bg-[#231C42]' : 'bg-[#EBF5FB]') +
                      ' w-9 h-9 items-center justify-center rounded-xl'
                    }
                  >
                    <Ionicons name="close" size={22} color={modalCloseIconColor} />
                  </AnimatedPressable>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text
                    className={
                      'mb-3 ' +
                      (isDark ? 'text-[#9C95C2]' : 'text-[#7F8C8D]') +
                      ' ' +
                      captionClassName
                    }
                  >
                    {capturedImage ? 'ตรวจสอบรูปแล้วกรอกค่า SYS / DIA / ชีพจร' : 'ยังไม่มีรูป (ถ่ายรูปหรือเลือกรูปก่อน แล้วค่อยบันทึก)'}
                  </Text>

                  <View className="flex-col gap-3">
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

                {/* Actions — close lives on the X icon at top right of the
                    sheet; the bottom row gives the two flow-changing actions:
                    retake (back to camera, keep typed values) and save.
                    Retake is neutral surface (Theme.surfaceMuted) — red
                    read as "destructive / discard" which we don't want for
                    a back-to-camera step that preserves the typed values.
                    Save is the brand accent purple gradient to match the
                    confirm row outside the modal. */}
                <View className="flex-row gap-3 mt-2">
                  <AnimatedPressable
                    onPress={retake}
                    className="flex-1 rounded-2xl overflow-hidden"
                  >
                    <View
                      className="flex-row items-center justify-center py-3.5 border"
                      style={{
                        backgroundColor: isDark ? '#231C42' : '#EBF5FB',
                        borderColor: isDark ? '#2D2654' : 'rgba(255,255,255,0.8)',
                      }}
                    >
                      <Ionicons name="refresh" size={18} color={isDark ? '#E8E4F5' : '#2C3E50'} />
                      <Text
                        className={'font-semibold ml-2 ' + bodyClassName}
                        style={{ color: isDark ? '#E8E4F5' : '#2C3E50' }}
                      >
                        ถ่ายใหม่
                      </Text>
                    </View>
                  </AnimatedPressable>

                  <AnimatedPressable
                    onPress={saveReading}
                    disabled={isSaving || !canAttemptSave}
                    className="flex-1 rounded-2xl overflow-hidden"
                  >
                    {isSaving || !canAttemptSave ? (
                      <View
                        className="flex-row items-center justify-center py-3.5"
                        style={{ backgroundColor: isDark ? '#2D2654' : '#BDC3C7' }}
                      >
                        <Ionicons name="save" size={18} color="white" />
                        <Text className={'text-white font-semibold ml-2 ' + bodyClassName}>
                          {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                        </Text>
                      </View>
                    ) : (
                      <LinearGradient
                        colors={isDark ? ['#9C7BD9', '#6B45B5', '#4A2D9C'] : ['#A879E8', '#7E57C2', '#5E35B1']}
                        className="flex-row items-center justify-center py-3.5"
                      >
                        <Ionicons name="save" size={18} color="white" />
                        <Text className={'text-white font-semibold ml-2 ' + bodyClassName}>
                          บันทึก
                        </Text>
                      </LinearGradient>
                    )}
                  </AnimatedPressable>
                </View>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>

      </View>
    </GradientBackground>
  );
}