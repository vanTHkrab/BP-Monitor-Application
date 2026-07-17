import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { DevMetricsChip, OcrEngineSelector } from '@/components/dev-ocr-controls';
import { GradientBackground } from '@/components/gradient-background';
import { UIImage } from '@/components/ui/image';
import { BPStatus, Colors, getBPStatus, getStatusText } from '@/constants/colors';
import { PHASE_LABEL, useCameraAnalysis } from '@/hooks/use-camera-analysis';
import { useAppStore } from '@/store/use-app-store';
import { cropToViewport } from '@/utils/crop-to-viewport';
import { fontPresetClass, getFontClass } from '@/utils/font-scale';
import { prepareImageForAnalysis } from '@/utils/image-prepare';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
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
  // home-indicator on iOS and gesture bar on Android). The (tabs) tab bar is
  // hidden on this route (see app/(tabs)/_layout.tsx → camera
  // `tabBarStyle: { display: 'none' }`), so the overlay bottom budget reserves
  // the safe-area inset plus a small breathing margin only — there is no tab
  // bar to clear. Leaving the screen is handled by the on-screen close (X)
  // button rendered over the header.
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

  // ─── Camera viewport geometry (WYSIWYG capture crop) ────────────────────────────
  // The full-screen CameraView renders in `cover` fit: the sensor feed is scaled
  // up to fill the screen and the overflow is cropped off-screen. But
  // `takePictureAsync` returns the *full* sensor frame (~4:3), wider/taller than
  // what the preview actually showed, so anything framed in the on-screen guide
  // ends up smaller/further-away in the saved JPEG (preview ≠ captured).
  //
  // We measure the live viewport via `onLayout` on the full-screen container
  // (rather than `Dimensions.get`) because that gives the *actual* rendered box
  // of the surface the preview cover-fits into — robust to rotation, the hidden
  // tab bar, and any insets, with no manual subtraction. We then center-crop the
  // captured photo to this aspect so capture matches preview. `viewportAspect`
  // is a ref (not state) so reading it in the async capture handler never closes
  // over a stale value and updating it on layout never triggers a re-render.
  const viewportAspect = useRef<number | null>(null);

  // ─── Capture timestamp (Item: measuredAt = capture time) ───────────────────────
  // Stamped when a capture lands in `capturedImage` (camera shot or gallery
  // pick) and passed to `save()` as `measuredAt`, so an offline
  // capture-then-late-save records the moment the photo was taken instead of
  // the moment the save button was pressed. Ref (not state) — it never
  // drives a render and reading it inside async handlers must never see a
  // stale closure value.
  const capturedAtRef = useRef<Date | null>(null);

  // ─── Modal / form state ───────────────────────────────────────────────────────
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  // Offline capture notice — informative (not error) banner in the entry
  // sheet telling the user the AI read was skipped because the device is
  // offline and manual entry + background sync is the path. Set by the
  // offline branch in startCaptureFlow, cleared on retake / reset / new
  // capture.
  const [offlineCapture, setOfflineCapture] = useState(false);

  // ─── Inline validation / banner state (P2) ─────────────────────────────────────
  // Per-field validation messages surfaced under each CustomInput via its
  // `error` prop. A field with an empty string ("") renders the red highlight
  // without text (companion-field flag) — used for the SYS≤DIA case where both
  // fields are wrong but only one message is shown. Replaces the six
  // Alert.alert validation popups.
  const [fieldErrors, setFieldErrors] = useState<{
    systolic?: string;
    diastolic?: string;
    pulse?: string;
  }>({});
  // Save-flow banner above the form (not-logged-in / save failure). Replaces
  // the Alert.alert error popups in saveReading.
  const [saveError, setSaveError] = useState<string | null>(null);

  // ─── Store ────────────────────────────────────────────────────────────────────
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  // Caregiver mode: a caregiver records readings on behalf of the active
  // patient (attribution happens in readings.slice → createReading, which
  // sends `patientId` with the mutation). The gate below blocks the camera
  // until a patient is selected; `activePatient` also feeds the "saving for"
  // chip in the entry sheet so the attribution is visible before saving.
  const user = useAppStore((s) => s.user);
  const activePatientId = useAppStore((s) => s.activePatientId);
  const myPatients = useAppStore((s) => s.myPatients);
  const isCaregiver = user?.role === 'caregiver';
  const activePatient = isCaregiver
    ? (myPatients.find((p) => p.id === activePatientId) ?? null)
    : null;
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
    lowConfidence,
    isSaving,
    analyze,
    readOnDevice,
    save,
    reset: resetAnalysis,
    confirmLowConfidence,
    dismissLowConfidence,
  } = useCameraAnalysis();

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

  // Low-confidence handling (P2). The AI read values but wasn't confident
  // enough to auto-fill (confidence < threshold). Rather than silently dropping
  // the reading — or popping an Alert — we surface an inline banner near the
  // form (rendered below) with "ใช้ค่านี้" / "แก้เอง" actions wired to the
  // SAME hook handlers the Alert used. The hook integration is unchanged: the
  // `lowConfidence` flag still drives the banner's visibility and is cleared by
  // `confirmLowConfidence` (promotes values into `prefill`) or
  // `dismissLowConfidence` (leaves the form empty). Derive the readable values
  // + confidence % for the banner copy.
  const lowConfidenceReadings =
    lowConfidence && result?.readings ? result.readings : null;
  const lowConfidencePct = Math.round((result?.confidence ?? 0) * 100);

  // ─── Derived ──────────────────────────────────────────────────────────────────
  // Icon tints come from the app palette (Theme.* in constants/colors.ts) so
  // the camera surface reads as the same product as the home / history tabs
  // rather than a stand-alone clinical sub-app.
  const modalCloseIconColor = isDark ? '#E8E4F5' : '#374151';

  const titleClassName = fontPresetClass.title(fontSizePreference);
  // raw: camera loading copy uses a tighter [15/base/17/lg] ramp to fit the spinner row.
  const loadingTextClassName = getFontClass(fontSizePreference, {
    small: 'text-[15px]',
    medium: 'text-base',
    large: 'text-[17px]',
    xlarge: 'text-lg',
  });
  // raw: camera error title scale mirrors `loadingText` for visual parity, not generic title.
  const cameraErrorTitleClassName = getFontClass(fontSizePreference, {
    small: 'text-[15px]',
    medium: 'text-base',
    large: 'text-[17px]',
    xlarge: 'text-lg',
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
  // Captures share the same post-resize flow: resize, then hand the image
  // straight to the backend analysis pipeline. On-device YOLO pre-flight is
  // currently bypassed in this UI flow — the backend YOLO does its own ROI
  // detection on the uploaded frame, so we don't gate or auto-crop on the
  // device. (The pre-flight service + bundled model are intentionally kept
  // in place so this bypass can be reverted without re-adding the plumbing.)
  const startCaptureFlow = async (uri: string, width: number, height: number) => {
    // A new capture means a fresh AI read — clear the form so the auto-fill
    // effect below writes the *new* readings into empty fields. Without this,
    // the effect's "don't clobber what the user typed" guard
    // (`prev.trim() ? prev : ...`) would also refuse to replace values left
    // over from a previous shot (e.g. after a retake, since `retake` keeps the
    // typed values on purpose). Clearing here scopes the overwrite to a real
    // new capture: within a single shot the guard still protects keystrokes
    // the user types while the AI is resolving. The clears flush long before
    // the async `analyze` round-trip resolves, so there's no race with prefill.
    setSystolic('');
    setDiastolic('');
    setPulse('');
    setFieldErrors({});
    setSaveError(null);
    setOfflineCapture(false);
    // prepareImageForAnalysis may resize (long-edge cap 1600px) and returns
    // the *post-resize* dimensions. We send the post-resize image to the
    // backend — uncropped — and let backend YOLO locate the monitor.
    const prepared = await prepareImageForAnalysis(uri, width, height);
    // Measurement time = capture time (see capturedAtRef). Stamped for both
    // camera shots and gallery picks, right where capturedImage is set.
    capturedAtRef.current = new Date();
    setCapturedImage(prepared.uri);

    // Offline: the backend analyze() is doomed without a network — skip it
    // instead of burning the request and surfacing a red "วิเคราะห์ไม่สำเร็จ".
    // Try the on-device OCR first (stub today — always unavailable, so this
    // is where the trained model activates with zero re-plumbing), then open
    // the manual entry sheet with an informative offline notice. The photo is
    // kept; save() queues it and syncPendingReadings uploads it later.
    if (!useAppStore.getState().isOnline) {
      await readOnDevice(prepared.uri);
      setOfflineCapture(true);
      setShowEntryModal(true);
      return;
    }

    void analyze(prepared.uri, { ocrEngine: ocrEngineOverride });
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
      // WYSIWYG: the live preview cover-fit the sensor feed into the full-screen
      // viewport, cropping the overflow off-screen, but `takePictureAsync`
      // returns the full sensor frame. Center-crop the captured photo to the
      // viewport aspect so "what was captured" == "what was framed". Only the
      // camera-capture path does this — gallery picks (pickImage) aren't bound
      // to the live preview, so there's no mismatch to correct and cropping
      // would discard image area for nothing.
      //
      // photo.width/height from takePictureAsync are already orientation-
      // normalized to the upright frame the user saw (the URI's pixels match
      // these dims), so photoAspect lines up with the on-screen viewportAspect
      // without an extra EXIF rotation step. If the viewport hasn't been
      // measured yet (no onLayout pass), cropToViewport receives a null aspect
      // and safely returns the original image.
      const cropped = await cropToViewport(
        photo.uri,
        photo.width,
        photo.height,
        viewportAspect.current ?? 0,
      );
      await startCaptureFlow(cropped.uri, cropped.width, cropped.height);
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

  // ─── Validation ───────────────────────────────────────────────────────────────
  // Physiologically-plausible bounds. Values outside these ranges almost
  // certainly indicate a typo or OCR misread; saving them would pollute
  // history and trigger spurious alerts.
  const SYS_MIN = 50, SYS_MAX = 250;
  const DIA_MIN = 30, DIA_MAX = 150;
  const HR_MIN = 30, HR_MAX = 220;

  // Pure validator (P2). Returns a per-field error map (empty when valid) so
  // the messages render inline under each CustomInput instead of in an Alert.
  // The SYS≤DIA case flags both fields: the message lives on `systolic`, and
  // `diastolic` gets a "" companion-flag so CustomInput shows the red border
  // without duplicating the text.
  const validateForm = (): {
    systolic?: string;
    diastolic?: string;
    pulse?: string;
  } => {
    const sys = Number(systolic);
    const dia = Number(diastolic);
    const hr = Number(pulse);
    const errors: { systolic?: string; diastolic?: string; pulse?: string } = {};

    if (!systolic.trim() || !Number.isFinite(sys)) errors.systolic = 'กรุณากรอกตัวเลข';
    else if (sys < SYS_MIN || sys > SYS_MAX) errors.systolic = 'ค่าตัวบนควรอยู่ระหว่าง 50–250';

    if (!diastolic.trim() || !Number.isFinite(dia)) errors.diastolic = 'กรุณากรอกตัวเลข';
    else if (dia < DIA_MIN || dia > DIA_MAX) errors.diastolic = 'ค่าตัวล่างควรอยู่ระหว่าง 30–150';

    if (!pulse.trim() || !Number.isFinite(hr)) errors.pulse = 'กรุณากรอกตัวเลข';
    else if (hr < HR_MIN || hr > HR_MAX) errors.pulse = 'ชีพจรควรอยู่ระหว่าง 30–220';

    // SYS ≤ DIA only meaningful once both are in-range numbers — flag both.
    if (!errors.systolic && !errors.diastolic && sys <= dia) {
      errors.systolic = 'ค่าตัวบนต้องมากกว่าตัวล่าง';
      errors.diastolic = '';
    }

    return errors;
  };

  // ─── Save handler ─────────────────────────────────────────────────────────────
  const saveReading = async () => {
    setSaveError(null);

    if (!isAuthenticated) {
      setSaveError('กรุณาเข้าสู่ระบบก่อนบันทึกข้อมูล');
      return;
    }

    // Caregiver saves are online-only (no offline queue — see the caregiver
    // branch in readings.slice.createReading). Surface the reason inline
    // instead of a generic failure after the slice declines.
    if (isCaregiver && !useAppStore.getState().isOnline) {
      setSaveError('การบันทึกแทนผู้ป่วยต้องเชื่อมต่ออินเทอร์เน็ต กรุณาลองใหม่เมื่อออนไลน์');
      return;
    }

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    if (!capturedImage) {
      setSaveError('กรุณาถ่ายรูปหรือเลือกรูปก่อนบันทึก');
      return;
    }

    const sys = Number(systolic);
    const dia = Number(diastolic);
    const hr = Number(pulse);

    try {
      const ok = await save({
        imageUri: capturedImage,
        systolic: sys,
        diastolic: dia,
        pulse: hr,
        // Capture time, not save time — offline capture-then-late-save must
        // not shift the measurement timestamp. Undefined (no capture stamp)
        // falls back to now inside the hook.
        measuredAt: capturedAtRef.current ?? undefined,
      });

      if (!ok) {
        setSaveError(
          isCaregiver
            ? 'บันทึกแทนผู้ป่วยไม่สำเร็จ กรุณาลองอีกครั้ง'
            : 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง',
        );
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
      // One-shot post-save BP-status confirmation with health advice — kept as
      // Alert per project convention (critical-BP confirmation). The full
      // inline result card is P3, out of scope here.
      Alert.alert(title, body, [{ text: 'ตกลง', onPress: proceed }]);
    } catch {
      setSaveError('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
  };

  // ─── Caregiver gate ───────────────────────────────────────────────────────────
  // A caregiver must pick the patient they are recording for before the
  // camera opens — otherwise the reading would have no attribution target
  // (readings.slice.createReading declines caregiver saves without an
  // active patient). Rendered before the permission gate so we never ask
  // for camera access we can't use yet. The root-level ActivePatientBanner
  // stays visible above this screen, so picking a patient from the top
  // banner dismisses the gate in place.
  if (isCaregiver && !activePatientId) {
    return (
      <GradientBackground>
        <FadeInView delay={150} className="flex-1">
          <View className="flex-1 items-center justify-center px-8">
            <View
              className={
                (isDark ? 'bg-[#0F172A] border border-[#1F2937]' : 'bg-[#EDE7F6]') +
                ' w-[120px] h-[120px] rounded-full items-center justify-center mb-6'
              }
            >
              <Ionicons name="people" size={56} color="#7E57C2" />
            </View>
            <Text
              className={
                (isDark ? 'text-[#E8E4F5]' : 'text-[#2C3E50]') +
                ' font-bold mb-3 text-center ' +
                titleClassName
              }
            >
              เลือกผู้ป่วยก่อนถ่ายภาพ
            </Text>
            <Text
              className={
                (isDark ? 'text-slate-400' : 'text-[#7F8C8D]') +
                ' text-center leading-6 mb-8 ' +
                fontPresetClass.body(fontSizePreference)
              }
            >
              คุณกำลังใช้โหมดผู้ดูแล กรุณาเลือกผู้ป่วยจากแถบด้านบน
              หรือหน้าจัดการผู้ป่วย ก่อนบันทึกค่าความดันแทนผู้ป่วย
            </Text>
            <AnimatedPressable onPress={() => router.push('/caregivers' as Href)}>
              <LinearGradient
                colors={['#A879E8', '#7E57C2', '#5E35B1']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                className="px-6 py-3.5 rounded-2xl flex-row items-center"
              >
                <Ionicons name="people-outline" size={18} color="white" />
                <Text className={'text-white font-bold ml-2 ' + fontPresetClass.body(fontSizePreference)}>
                  จัดการผู้ป่วย
                </Text>
              </LinearGradient>
            </AnimatedPressable>
          </View>
        </FadeInView>
      </GradientBackground>
    );
  }

  // ─── Loading state ────────────────────────────────────────────────────────────
  if (!permission) {
    return (
      <GradientBackground>
        <View className="flex-1 items-center justify-center">
          <Text className={(isDark ? 'text-[#E8E4F5]' : 'text-[#2C3E50]') + ' ' + loadingTextClassName}>กำลังโหลด...</Text>
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
                // raw: permission hero title runs one scale step larger than canonical `title`.
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
                fontPresetClass.body(fontSizePreference)
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
            {/* Secondary recovery action — if the permission grant has
                landed but the CameraView still hasn't picked it up (state
                desync after hot-reload, OS lifecycle quirks), force the
                hook to re-evaluate and bump the camera key so the next
                render mounts a fresh CameraView. */}
            <Pressable
              onPress={async () => {
                await requestPermission();
                retryCamera();
              }}
              className="mt-3"
              accessibilityRole="button"
              accessibilityLabel="ลองใช้กล้องอีกครั้ง"
            >
              <Text
                className={
                  'font-semibold underline ' +
                  (isDark ? 'text-[#9BEAF7]' : 'text-[#1898D4]') +
                  ' ' +
                  // raw: inline retry link scale, kept tight to sit under the CustomButton.
                  getFontClass(fontSizePreference, {
                    small: 'text-[13px]',
                    medium: 'text-sm',
                    large: 'text-base',
                    xlarge: 'text-lg',
                  })
                }
              >
                ลองใช้กล้องอีกครั้ง
              </Text>
            </Pressable>
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
    setFieldErrors({});
    setSaveError(null);
    setOfflineCapture(false);
    capturedAtRef.current = null;
    resetAnalysis();
  };

  const resetAll = () => {
    setCapturedImage(null);
    setShowEntryModal(false);
    setSystolic('');
    setDiastolic('');
    setPulse('');
    setFieldErrors({});
    setSaveError(null);
    setOfflineCapture(false);
    capturedAtRef.current = null;
    resetAnalysis();
  };

  const retryCamera = () => {
    setCameraMountError(null);
    setCameraKey((k) => k + 1);
    setIsCameraReady(false);
  };

  const openEntry = () => setShowEntryModal(true);

  // Leave the camera screen. The bottom tab bar is hidden on this route, so
  // this on-screen close (X) is the user's way out. Prefer popping the back
  // stack when there is one (matches the post-save `router.back()` path and
  // the rest of the app's modal/screen back affordances); otherwise fall back
  // to the home tab so the user is never stranded on a bar-less screen.
  const closeCamera = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  // The save button is locked while AI work is in flight (the user shouldn't
  // be able to persist values the AI is still resolving) and during the save
  // round-trip itself. `aiBusy` mirrors the in-flight backend phases.
  const aiBusy = phase === 'uploading' || phase === 'queued' || phase === 'processing';
  const canAttemptSave =
    Boolean(capturedImage) &&
    !!systolic.trim() &&
    !!diastolic.trim() &&
    !!pulse.trim();
  // The primary save button is genuinely non-tappable when busy or incomplete.
  const saveDisabled = isSaving || aiBusy || !canAttemptSave;
  // Busy label takes priority: "กำลังบันทึก..." during the save round-trip,
  // "กรุณารอสักครู่" while the AI is still resolving the reading.
  const saveLabel = isSaving
    ? 'กำลังบันทึก...'
    : aiBusy
      ? 'กรุณารอสักครู่'
      : 'บันทึก';

  // Bottom overlay padding budget. The bottom tab bar IS visible on this
  // route (app/(tabs)/_layout.tsx → camera `tabBarStyle: { display: 'none' }`
  // is commented out), and it is an absolutely-positioned purple bar, so the
  // controls overlay must clear it as well as the safe-area inset.
  //
  // TAB_BAR_TOTAL_HEIGHT mirrors the geometry in app/(tabs)/_layout.tsx:
  //   tabBarBaseHeight (60 iOS / 62 Android) + insets.bottom + marginBottom
  //   (2 iOS / 4 Android). It is duplicated here as a local constant rather
  //   than imported to avoid coupling this screen to the navigator config —
  //   if those numbers change in _layout.tsx, update this constant to match.
  const tabBarBaseHeight = Platform.OS === 'ios' ? 60 : 62;
  const tabBarMarginBottom = Platform.OS === 'ios' ? 2 : 4;
  const tabBarTotalHeight = tabBarBaseHeight + insets.bottom + tabBarMarginBottom;
  // Lift the controls clear of the tab bar, then add 14px breathing room.
  const bottomOverlayPadding = tabBarTotalHeight + 14;
  const captionClassName = fontPresetClass.caption(fontSizePreference);
  const bodyClassName = fontPresetClass.body(fontSizePreference);

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
        {/* No paddingBottom — the camera/preview surface below must sit
            flush against the header (no visible gap), per the redesigned
            layout. The gradient header pill keeps its own internal padding. */}
        {/* <View className="items-center justify-center" style={{ paddingTop: insets.top + 12, paddingBottom: 0 }}>
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
        </View> */}

        {/* ── Camera / Preview ── */}
        {!capturedImage ? (
          // Full-screen camera: the CameraView fills the whole screen
          // (`absolute inset-0`) and every chrome element (status / guide
          // frame / controls) floats on top as an absolute overlay keyed off
          // the safe-area insets. The previous layout letterboxed the sensor
          // to a 3:4 viewport with the controls in a flex gap below; this
          // redesign hands the entire viewport to the live preview so the
          // user frames the monitor against the full sensor feed.
          <View
            className="absolute inset-0 bg-black"
            // Measure the rendered viewport box the CameraView cover-fits into.
            // We store the aspect (w/h) in a ref and use it to center-crop the
            // captured photo so capture matches preview (see takePicture). Using
            // the measured box — not Dimensions.get — keeps this robust to
            // rotation and the hidden tab bar with no manual inset math.
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              if (width > 0 && height > 0) {
                viewportAspect.current = width / height;
              }
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
                  <Text className={(isDark ? 'text-[#E8E4F5]' : 'text-[#2C3E50]') + ' mt-2 font-extrabold ' + cameraErrorTitleClassName}>
                    กล้องใช้งานไม่ได้
                  </Text>
                  <Text className={isDark ? 'mt-1.5 text-[13px] text-[#9C95C2] text-center' : 'mt-1.5 text-[13px] text-[#7F8C8D] text-center'} numberOfLines={3}>
                    {cameraMountError}
                  </Text>
                  <View className="flex-row gap-2.5 mt-3 w-full">
                    <AnimatedPressable
                      onPress={retryCamera}
                      className="flex-1 rounded-[14px] overflow-hidden"
                      accessibilityRole="button"
                      accessibilityLabel="ลองเปิดกล้องใหม่"
                    >
                      <LinearGradient colors={['#A879E8', '#7E57C2', '#5E35B1']} className="flex-row items-center justify-center py-3">
                        <Ionicons name="refresh" size={18} color="white" />
                        <Text className={"text-white font-bold ml-2 " + captionClassName}>ลองใหม่</Text>
                      </LinearGradient>
                    </AnimatedPressable>
                    <AnimatedPressable
                      onPress={() => void Linking.openSettings()}
                      className="flex-1 rounded-[14px] overflow-hidden"
                      accessibilityRole="button"
                      accessibilityLabel="เปิดหน้าตั้งค่าสิทธิ์กล้อง"
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
                  className="absolute inset-0"
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
              </>
            )}

            {/* Dev-only OCR engine picker — floats top-left below the safe
                area. Hidden via the component's own ``devMode`` gate when
                off, so production users see no overlay. */}
            <View
              className="absolute left-3 right-3 pointer-events-box-none"
              style={{ top: insets.top + 8 }}
            >
              <OcrEngineSelector />
            </View>

            {/* Guide frame — floats centered over the full-screen preview
                (75% width, square 1:1 inner box — taller than the old 4:3 to
                better fit upright BP monitors). Mint corners + a faint center
                crosshair to help aim at the middle of the screen; no pulse
                animation — a static guide reads calmer in a medical capture
                context. */}
            {/* Center the guide frame within the space *above* the tab bar,
                not the full screen — otherwise the visible tab bar pulls the
                perceived center downward. Bottom inset = tabBarTotalHeight so
                `justify-center` centers between the top edge and the tab bar. */}
            <View
              className="absolute top-0 left-0 right-0 items-center justify-center pointer-events-none"
              style={{ bottom: tabBarTotalHeight }}
            >
              <ScaleOnMount delay={300}>
                <View className="flex-row items-center bg-black/60 px-4 py-2.5 rounded-2xl mb-5">
                  <Ionicons name="scan-outline" size={18} color="white" />
                  <Text className={"text-white font-medium ml-2 " + bodyClassName}>
                    วางหน้าจอเครื่องวัดให้ตรงกรอบ
                  </Text>
                </View>
              </ScaleOnMount>
              <View className="w-[75%] aspect-square relative">
                <View className="absolute top-0 left-0 w-10 h-10 border-[#34D399] border-t-[3px] border-l-[3px] rounded-tl-xl" />
                <View className="absolute top-0 right-0 w-10 h-10 border-[#34D399] border-t-[3px] border-r-[3px] rounded-tr-xl" />
                <View className="absolute bottom-0 left-0 w-10 h-10 border-[#34D399] border-b-[3px] border-l-[3px] rounded-bl-xl" />
                <View className="absolute bottom-0 right-0 w-10 h-10 border-[#34D399] border-b-[3px] border-r-[3px] rounded-br-xl" />
                {/* Center crosshair — faint white lines crossing at the middle
                    of the frame to help center the monitor. Thin, low-opacity,
                    short, and non-interactive so it guides without obscuring
                    the live feed. */}
                <View className="absolute top-1/2 left-1/2 w-8 h-px -ml-4 -mt-px bg-white/40" />
                <View className="absolute top-1/2 left-1/2 w-px h-8 -ml-px -mt-4 bg-white/40" />
              </View>
            </View>

            {/* Camera controls — float over the bottom of the full-screen
                preview. A bottom-up scrim keeps the white glyphs legible
                against bright sensor feeds. The three actions (gallery /
                capture / manual entry) sit above the home-indicator via the
                safe-area inset budget. */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.55)']}
              className="absolute bottom-0 left-0 right-0 pt-10"
              style={{ paddingBottom: bottomOverlayPadding }}
            >
              <View className="flex-row justify-between items-center px-10">
                <AnimatedPressable
                  onPress={pickImage}
                  className="w-[70px] items-center"
                  accessibilityRole="button"
                  accessibilityLabel="เลือกรูปจากอัลบั้ม"
                >
                  <View className="w-[50px] h-[50px] rounded-full bg-white/[0.12] border border-white/15 items-center justify-center">
                    <Ionicons name="images" size={22} color="white" />
                  </View>
                  <Text className={'text-white mt-1.5 font-medium ' + captionClassName}>
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
                  accessibilityRole="button"
                  accessibilityLabel="ถ่ายภาพเครื่องวัดความดัน"
                  accessibilityState={{ disabled: isCapturing, busy: isCapturing }}
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
                  <Text className={'text-white mt-1.5 font-medium text-center ' + captionClassName}>
                    {isCapturing ? 'กำลังถ่าย...' : 'ถ่ายภาพ'}
                  </Text>
                </Pressable>

                <AnimatedPressable
                  onPress={() => setShowEntryModal(true)}
                  className="w-[70px] items-center"
                  accessibilityRole="button"
                  accessibilityLabel="กรอกค่าความดันด้วยตนเอง"
                >
                  <View className="w-[50px] h-[50px] rounded-full bg-white/[0.12] border border-white/15 items-center justify-center">
                    <Ionicons name="create" size={22} color="white" />
                  </View>
                  <Text className={'text-white mt-1.5 font-medium ' + captionClassName}>
                    กรอกค่า
                  </Text>
                </AnimatedPressable>
              </View>
            </LinearGradient>
          </View>
        ) : (
          /* ── Image preview ── */
          // Full-screen preview to match the live camera branch above: the
          // captured frame fills the whole viewport (`absolute inset-0` over a
          // black backdrop) exactly like `CameraView`, and every chrome element
          // (phase status chip, failed-run recovery, retake / confirm row)
          // floats on top as an absolute overlay keyed off the safe-area insets.
          // `contentFit="contain"` (not cover) is deliberate — the whole BP
          // monitor must stay visible so the user can eye-check it against the
          // AI read before saving; cover would crop the digits at the edges.
          // The black backdrop fills the letterbox bars contain leaves around a
          // non-fullscreen-aspect photo, keeping the surface visually identical
          // to the live camera state.
          <View className="absolute inset-0 bg-black">
            <UIImage source={capturedImage} className="absolute inset-0" contentFit="contain" />

            {/* AI analysis status badge — card lift over the preview using
                the app's surface palette (white light / #1A1632 dark). The
                phase dot reuses status colours from Colors.status (green
                normal, orange elevated, red high) and the primary brand
                cyan for in-flight phases, so the indicator language is
                shared with home / history badges. */}
            {phase !== 'idle' && (
              <View className="absolute top-20 left-0 right-0 items-center">
                <View
                  // Announce phase transitions to screen readers as the
                  // analysis moves uploading → queued → processing → done.
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={PHASE_LABEL[phase]}
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

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.8)']}
              className="absolute bottom-0 left-0 right-0 px-4 pt-6"
              // Reserve space for the home-indicator / gesture bar only — the
              // (tabs) tab bar is hidden on this route (see _layout.tsx →
              // camera `tabBarStyle: { display: 'none' }`), so the safe-area
              // inset plus breathing room keeps the retake / confirm row
              // reachable. Same budget as the live state above.
              style={{ paddingBottom: bottomOverlayPadding }}
            >
              {/* AI analysis failed recovery — gives the user an explicit
                  way back to the camera AND a hard remount of the native
                  CameraView (bumped via `cameraKey`) so a stuck preview
                  surface from the failed run doesn't carry over to the
                  next attempt. Only renders on `failed` since `idle` /
                  `done` / in-flight phases have their own affordances. */}
              {phase === 'failed' && (
                <View className="mb-3">
                  <AnimatedPressable
                    onPress={() => { retake(); retryCamera(); }}
                    className="rounded-2xl overflow-hidden shadow-lg"
                    accessibilityRole="button"
                    accessibilityLabel="ลองใช้กล้องอีกครั้ง"
                  >
                    <View
                      className="flex-row items-center justify-center px-5 py-3 border"
                      style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderColor: 'rgba(235,245,251,0.9)' }}
                    >
                      <Ionicons name="camera-reverse" size={20} color="#1898D4" />
                      <Text className={"font-semibold ml-2 " + bodyClassName} style={{ color: '#1898D4' }}>
                        ลองใช้กล้องอีกครั้ง
                      </Text>
                    </View>
                  </AnimatedPressable>
                </View>
              )}

              {/* Retake = neutral brand-dark surface (Theme.dark.surfaceMuted
                  reads as a calm neutral over the photo without screaming
                  destructive). Confirm = brand accent purple gradient — the
                  primary-action language shared with the rest of the app. */}
              <View className="flex-row justify-center gap-3">
                <AnimatedPressable
                  onPress={retake}
                  className="flex-1 rounded-2xl overflow-hidden shadow-lg"
                  accessibilityRole="button"
                  accessibilityLabel="ถ่ายภาพใหม่"
                >
                  <View
                    className="flex-row items-center justify-center px-5 py-3.5 border"
                    style={{ backgroundColor: '#231C42', borderColor: '#2D2654' }}
                  >
                    <Ionicons name="refresh" size={20} color="#E8E4F5" />
                    <Text className={"font-semibold ml-2 " + bodyClassName} style={{ color: '#E8E4F5' }}>ถ่ายใหม่</Text>
                  </View>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={openEntry}
                  className="flex-1 rounded-2xl overflow-hidden shadow-lg"
                  accessibilityRole="button"
                  accessibilityLabel="ยืนยันภาพและกรอกค่าความดัน"
                >
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
                    accessibilityRole="button"
                    accessibilityLabel="ปิดหน้ากรอกค่าความดัน"
                  >
                    <Ionicons name="close" size={22} color={modalCloseIconColor} />
                  </AnimatedPressable>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {/* Caregiver attribution chip — makes it explicit whose
                      record this save writes to before the button is hit. */}
                  {activePatient && (
                    <View
                      className="mb-2 flex-row items-center rounded-xl px-3 py-2"
                      style={{ backgroundColor: 'rgba(126,87,194,0.12)' }}
                    >
                      <Ionicons name="people" size={16} color="#7E57C2" style={{ marginRight: 6 }} />
                      <Text
                        className={'flex-1 font-semibold ' + captionClassName}
                        style={{ color: '#7E57C2' }}
                        numberOfLines={1}
                      >
                        บันทึกให้ คุณ {activePatient.firstname} {activePatient.lastname}
                      </Text>
                    </View>
                  )}
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

                  {/* Offline capture notice — informative, not an error, so it
                      uses the brand cyan (Colors.primary.blue family), never
                      red. Tells the user the AI read was skipped and manual
                      entry + background sync is the normal path. Caregivers
                      get different copy: their saves are online-only (no
                      offline queue), so promising a background sync would be
                      a lie — the save gate below still blocks them. */}
                  {offlineCapture && (
                    <View
                      accessibilityLiveRegion="polite"
                      className="mb-3 rounded-xl px-3.5 py-3 flex-row items-start"
                      style={{
                        backgroundColor: 'rgba(53,184,232,0.12)',
                        borderWidth: 1,
                        borderColor: '#35B8E8',
                      }}
                    >
                      <Ionicons
                        name="cloud-offline-outline"
                        size={18}
                        color={isDark ? '#9BEAF7' : '#1898D4'}
                        style={{ marginRight: 8, marginTop: 1 }}
                      />
                      <Text
                        className={'flex-1 font-semibold ' + captionClassName}
                        style={{ color: isDark ? '#9BEAF7' : '#0E6E9E' }}
                      >
                        {isCaregiver
                          ? 'ตอนนี้ออฟไลน์อยู่ การบันทึกแทนผู้ป่วยต้องเชื่อมต่ออินเทอร์เน็ต กรุณาลองใหม่เมื่อกลับมาออนไลน์'
                          : 'ตอนนี้ออฟไลน์อยู่ กรอกค่าจากหน้าจอเครื่องวัดได้เลย ระบบจะซิงก์ข้อมูลและรูปให้อัตโนมัติเมื่อกลับมาออนไลน์'}
                      </Text>
                    </View>
                  )}

                  {/* Save-flow error banner (P2) — not-logged-in / save failure.
                      Colors.status.high (#E74C3C). Replaces the Alert.alert
                      error popups. assertive so screen readers interrupt. */}
                  {saveError && (
                    <View
                      accessibilityRole="alert"
                      accessibilityLiveRegion="assertive"
                      className="mb-3 rounded-xl px-3.5 py-3 flex-row items-center"
                      style={{ backgroundColor: 'rgba(231,76,60,0.12)', borderWidth: 1, borderColor: '#E74C3C' }}
                    >
                      <Ionicons name="alert-circle" size={18} color="#E74C3C" style={{ marginRight: 8 }} />
                      <Text className={'flex-1 font-semibold ' + captionClassName} style={{ color: '#E74C3C' }}>
                        {saveError}
                      </Text>
                    </View>
                  )}

                  {/* Low-confidence inline banner (P2) — replaces the
                      Alert.alert prompt. Colors.status.elevated (#F39C12).
                      "ใช้ค่านี้" / "แก้เอง" call the SAME hook handlers
                      (confirmLowConfidence / dismissLowConfidence) the Alert
                      used; the hook integration is unchanged. */}
                  {lowConfidenceReadings && (
                    <View
                      accessibilityLiveRegion="polite"
                      className="mb-3 rounded-xl px-3.5 py-3"
                      style={{ backgroundColor: 'rgba(243,156,18,0.12)', borderWidth: 1, borderColor: '#F39C12' }}
                    >
                      <View className="flex-row items-center mb-1">
                        <Ionicons name="help-circle" size={18} color="#B97400" style={{ marginRight: 8 }} />
                        <Text className={'font-semibold ' + bodyClassName} style={{ color: '#7A4E00' }}>
                          ช่วยตรวจสอบตัวเลขให้หน่อยนะคะ
                        </Text>
                      </View>
                      <Text className={'mb-3 ' + captionClassName} style={{ color: 'rgba(122,78,0,0.92)' }}>
                        {`ระบบไม่แน่ใจ (ความมั่นใจ ${lowConfidencePct}%) กรุณาเทียบกับหน้าจอเครื่องวัด`}
                      </Text>
                      <View className="flex-row gap-2">
                        <AnimatedPressable
                          onPress={confirmLowConfidence}
                          className="flex-1 rounded-lg overflow-hidden"
                          accessibilityRole="button"
                          accessibilityLabel="ใช้ค่าที่ระบบอ่านได้"
                        >
                          <LinearGradient
                            colors={['#A879E8', '#7E57C2', '#5E35B1']}
                            className="px-3 py-2 items-center"
                          >
                            <Text className={'text-white font-semibold ' + captionClassName}>ใช้ค่านี้</Text>
                          </LinearGradient>
                        </AnimatedPressable>
                        <AnimatedPressable
                          onPress={dismissLowConfidence}
                          className="flex-1 rounded-lg overflow-hidden"
                          accessibilityRole="button"
                          accessibilityLabel="กรอกค่าด้วยตนเอง"
                        >
                          <View
                            className="px-3 py-2 items-center border"
                            style={{ backgroundColor: '#FFF4E0', borderColor: 'rgba(217,119,6,0.45)' }}
                          >
                            <Text className={'font-semibold ' + captionClassName} style={{ color: '#7A4E00' }}>แก้เอง</Text>
                          </View>
                        </AnimatedPressable>
                      </View>
                    </View>
                  )}

                  <View className="flex-col gap-3">
                    <View>
                      <CustomInput
                        placeholder="SYS"
                        value={systolic}
                        onChangeText={(t) => {
                          setSystolic(t);
                          if (fieldErrors.systolic !== undefined || fieldErrors.diastolic !== undefined) {
                            setFieldErrors((prev) => ({ ...prev, systolic: undefined, diastolic: undefined }));
                          }
                          if (saveError) setSaveError(null);
                        }}
                        icon="arrow-up"
                        keyboardType="numeric"
                        error={fieldErrors.systolic}
                      />
                    </View>
                    <View>
                      <CustomInput
                        placeholder="DIA"
                        value={diastolic}
                        onChangeText={(t) => {
                          setDiastolic(t);
                          if (fieldErrors.diastolic !== undefined || fieldErrors.systolic !== undefined) {
                            setFieldErrors((prev) => ({ ...prev, diastolic: undefined, systolic: undefined }));
                          }
                          if (saveError) setSaveError(null);
                        }}
                        icon="arrow-down"
                        keyboardType="numeric"
                        error={fieldErrors.diastolic}
                      />
                    </View>
                    <View>
                      <CustomInput
                        placeholder="ชีพจร"
                        value={pulse}
                        onChangeText={(t) => {
                          setPulse(t);
                          if (fieldErrors.pulse !== undefined) {
                            setFieldErrors((prev) => ({ ...prev, pulse: undefined }));
                          }
                          if (saveError) setSaveError(null);
                        }}
                        icon="heart"
                        keyboardType="numeric"
                        error={fieldErrors.pulse}
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
                    accessibilityRole="button"
                    accessibilityLabel="ถ่ายภาพใหม่"
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
                    disabled={saveDisabled}
                    className="flex-1 rounded-2xl overflow-hidden"
                    accessibilityRole="button"
                    accessibilityLabel="บันทึกค่าความดัน"
                    // Greyed + non-tappable while AI is in flight or the save
                    // round-trip is running; busy is announced to a11y tooling.
                    accessibilityState={{ disabled: saveDisabled, busy: isSaving || aiBusy }}
                  >
                    {saveDisabled ? (
                      <View
                        className="flex-row items-center justify-center py-3.5"
                        style={{ backgroundColor: isDark ? '#2D2654' : Colors.button.disabled }}
                      >
                        <Ionicons name="save" size={18} color="white" />
                        <Text className={'text-white font-semibold ml-2 ' + bodyClassName}>
                          {saveLabel}
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