/**
 * Camera. Ported from `client-old/app/(tabs)/camera.tsx` (1,764 lines).
 *
 * **The layout is the original's**: full-bleed preview, the floating close /
 * auto-capture row, the corner-bracket guide frame with its crosshair and
 * coaching pill, the 88px shutter with its countdown ring, the three-action
 * control row, and the bottom-sheet entry form with its offline /
 * low-confidence / error banners. Copy, radii, and the status colour language
 * are unchanged.
 *
 * What the flow does, in one paragraph, because it is spread across several
 * handlers: a capture (or a gallery pick) is resized, stamped with the moment
 * it was taken, and shown full-screen. Online it goes to the backend AI
 * pipeline; offline that request is skipped entirely — it would only fail — and
 * the on-device engine tries instead. Either way the entry sheet opens with
 * whatever numbers were read, or empty, and the save goes through the readings
 * queue. **Nothing on this screen can prevent a reading being recorded.**
 *
 * Differences from the original, all of them because of what this tree does
 * differently rather than by choice:
 *
 *   - **Saving is queue-first.** `useCreateReading` writes to SQLite and
 *     returns, so there is no "save failed" round trip to report and the old
 *     boolean-return branch is gone. A caregiver saving offline now queues like
 *     anyone else — client-old blocked that because its store had no on-behalf
 *     queue path.
 *   - **`isOnline` is read from NetInfo at capture time** rather than from a
 *     store slice. One question, asked at the only moment the answer matters.
 *   - **The dev OCR controls are not here** — the engine picker, the metrics
 *     chip, and the detector benchmark belong on `app/debug.tsx` in this tree.
 *     `analyze()` still accepts `ocrEngine`, so wiring them is additive.
 */
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import { useActivePatient } from '@/modules/caregivers';
import {
  BpCameraView,
  PHASE_LABEL,
  cropToViewport,
  isLiveDetectionSupported,
  prepareImageForAnalysis,
  useCameraAnalysis,
  useLiveFraming,
  type BPValues,
  type BpCameraViewRef,
  type FramingState,
} from '@/modules/capture';
import { classifyReading, statusGuidance, statusLabel } from '@/modules/readings';
import { usePreferencesStore } from '@/stores';
import { gradientFor, palette, status as statusColor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

/**
 * How each framing verdict looks and reads.
 *
 * Colour is never the only signal — every state carries its own sentence, so
 * the guidance works for a colour-blind user and for a screen reader. The copy
 * is imperative and names the fix rather than the fault: "เข้าใกล้อีกนิด" tells
 * the user what to do, "ไกลเกินไป" only tells them they were wrong.
 */
const FRAMING_PRESENTATION: Record<
  FramingState,
  { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  searching: { color: '#34D399', icon: 'scan-outline', label: 'วางหน้าจอเครื่องวัดให้ตรงกรอบ' },
  'too-far': { color: statusColor.elevated, icon: 'add-circle-outline', label: 'เข้าใกล้อีกนิด' },
  'too-close': {
    color: statusColor.elevated,
    icon: 'remove-circle-outline',
    label: 'ถอยออกนิดหนึ่ง',
  },
  'off-center': {
    color: statusColor.elevated,
    icon: 'move-outline',
    label: 'จัดหน้าจอให้อยู่กลางกรอบ',
  },
  ready: { color: statusColor.normal, icon: 'checkmark-circle-outline', label: 'พร้อมถ่ายแล้ว' },
};

/** Physiologically plausible bounds. Outside them is a typo or a misread. */
const BOUNDS = {
  systolic: { min: 50, max: 250 },
  diastolic: { min: 30, max: 150 },
  pulse: { min: 30, max: 220 },
} as const;

/** The press feedback client-old got from its `AnimatedPressable`. */
function TapScale({ children, style, ...props }: PressableProps) {
  return (
    <Pressable
      {...props}
      style={(state) => [
        { transform: [{ scale: state.pressed ? 0.97 : 1 }] },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const colors = useTheme();
  const fontScale = useFontScale();
  const { scheme } = useColorSchemePreference();
  const isDark = scheme === 'dark';
  const accent = gradientFor(scheme, 'accent');

  const { user, isAuthenticated } = useSession();
  const { patient: activePatient, viewingPatientId } = useActivePatient();
  const isCaregiver = user?.role === 'caregiver';

  const autoCapture = usePreferencesStore((state) => state.autoCapture);
  const setAutoCapture = usePreferencesStore((state) => state.setAutoCapture);

  const [permission, requestPermission] = useCameraPermissions();

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraMountError, setCameraMountError] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [isCameraReady, setCameraReady] = useState(false);
  const [isCapturing, setCapturing] = useState(false);
  /**
   * The re-entrancy guard, on a ref rather than on `isCapturing`. State is only
   * visible to the *next* render, so two taps landing in the same tick both
   * read `false` and both fire the shutter — easy to do on a slow Android
   * panel, and auto-capture can race the user's own tap the same way.
   */
  const capturingRef = useRef(false);
  const cameraRef = useRef<BpCameraViewRef>(null);

  /**
   * The rendered viewport's aspect, measured rather than computed from
   * `Dimensions` so it stays right through rotation, the tab bar, and insets.
   * A ref because reading it inside the async capture handler must not see a
   * stale closure, and writing it on layout must not re-render.
   */
  const viewportAspect = useRef<number | null>(null);
  /** When the photo was taken. This is the measurement time — see `saveReading`. */
  const capturedAtRef = useRef<Date | null>(null);

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [offlineCapture, setOfflineCapture] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    systolic?: string;
    diastolic?: string;
    pulse?: string;
  }>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    phase,
    result,
    lowConfidence,
    isSaving,
    analyze,
    readOnDevice,
    save,
    reset: resetAnalysis,
    dismissLowConfidence,
  } = useCameraAnalysis();

  // ── Live framing gate ─────────────────────────────────────────────────────
  // Android real builds only. Elsewhere `onDetections` never fires, the state
  // stays `searching`, and this renders exactly the static guide frame the
  // screen would have had anyway. That degraded mode is supported, not an
  // error case.
  //
  // `takePicture` is declared below and would be in the temporal dead zone if
  // the hook closed over it, so auto-capture goes through a ref.
  const takePictureRef = useRef<() => void>(() => {});
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (!cancelled) setScreenReaderEnabled(on);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setScreenReaderEnabled,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const {
    state: framingState,
    isCountingDown,
    countdownProgress,
    onFrame: onFramingFrame,
    cancelAutoCapture,
    reset: resetFraming,
  } = useLiveFraming({
    // Detection stops the moment a photo is on screen: there is nothing left
    // to guide, and leaving it on burns CPU behind a still image.
    enabled: !capturedImage && !cameraMountError,
    autoCaptureEnabled: autoCapture,
    screenReaderEnabled,
    onAutoCapture: () => takePictureRef.current(),
  });

  // Announced once, when the countdown starts. The ring means nothing to a
  // screen reader, and re-announcing every tick would talk over the user while
  // they decide whether to cancel.
  useEffect(() => {
    if (!isCountingDown) return;
    AccessibilityInfo.announceForAccessibility('พร้อมถ่ายแล้ว กำลังจะถ่ายอัตโนมัติ แตะเพื่อยกเลิก');
  }, [isCountingDown]);

  // ── Analysis progress ─────────────────────────────────────────────────────
  // Rough per-phase progress, not a byte count — the poll only reports
  // pending / processing / done. It exists so the status pill's dot is not the
  // only evidence that anything is happening.
  // Lazy `useState`, not `useRef().current`: an `Animated.Value` has to be
  // created once and never during a render pass, and a ref read in the render
  // body is exactly what the compiler's ref rule is there to stop.
  const [progressAnim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const targets: Partial<Record<typeof phase, number>> = {
      reading: 0.4,
      uploading: 0.3,
      queued: 0.55,
      processing: 0.85,
      done: 1,
    };
    const next = targets[phase];
    if (next === undefined) {
      // idle / failed: snap to empty so the next capture starts from zero
      // rather than resuming mid-way from a stale value.
      progressAnim.setValue(0);
      return;
    }
    Animated.timing(progressAnim, { toValue: next, duration: 350, useNativeDriver: false }).start();
  }, [phase, progressAnim]);

  /**
   * Fill the form from a read, without overwriting the user.
   *
   * The functional form reads the *current* value at update time, so a slow
   * analysis landing while someone is already typing cannot clobber their
   * keystrokes — the closure pitfall a `!systolic.trim()` check falls into.
   * Called from the handler that awaited the read rather than from an effect
   * watching it: writing form state from analysis state in an effect is a
   * cascading render, and the compiler is right to reject it.
   */
  const applyReading = (values: BPValues) => {
    setSystolic((prev) => (prev.trim() ? prev : String(values.systolic)));
    setDiastolic((prev) => (prev.trim() ? prev : String(values.diastolic)));
    setPulse((prev) => (prev.trim() ? prev : String(values.pulse)));
  };

  const lowConfidenceReadings = lowConfidence && result?.readings ? result.readings : null;
  const lowConfidencePct = Math.round((result?.confidence ?? 0) * 100);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const requestCameraPermission = async () => {
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

      const granted = await requestPermission();
      if (!granted.granted && granted.canAskAgain === false) {
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

  /**
   * Everything a new photo triggers, whether it came from the camera or the
   * gallery.
   *
   * The fields are cleared first: the auto-fill effect above refuses to
   * clobber what the user typed, and without this that guard would also refuse
   * to replace values left over from the previous shot. Clearing here scopes
   * the overwrite to a genuinely new capture.
   */
  const startCaptureFlow = async (uri: string, width: number, height: number) => {
    setSystolic('');
    setDiastolic('');
    setPulse('');
    setFieldErrors({});
    setSaveError(null);
    setOfflineCapture(false);

    const prepared = await prepareImageForAnalysis(uri, width, height);
    capturedAtRef.current = new Date();
    setCapturedImage(prepared.uri);

    // Offline: the backend call is doomed, so it is not made. Burning it would
    // cost a timeout and end in a red "วิเคราะห์ไม่สำเร็จ" the user cannot act
    // on. Android tries the on-device engine instead; iOS, web, and Expo Go
    // land on plain manual entry. Either way the photo is kept and the save
    // queues.
    const { isConnected } = await NetInfo.fetch();
    if (isConnected === false) {
      const outcome = await readOnDevice(prepared.uri);
      if (outcome?.confident) applyReading(outcome.readings);
      setOfflineCapture(true);
      setShowEntryModal(true);
      return;
    }

    // Not awaited: the preview and its controls stay live while the backend
    // works. An uncertain read is left for the banner to offer.
    void analyze(prepared.uri).then((outcome) => {
      if (outcome?.confident) applyReading(outcome.readings);
    });
  };

  const takePicture = async () => {
    if (!cameraRef.current) return;
    if (capturingRef.current) return;
    capturingRef.current = true;

    // Tactile confirmation that the shutter fired — the visual press feedback
    // alone is easy to miss on cheaper panels.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCapturing(true);

    try {
      const photo = await cameraRef.current.capture();
      // The preview cover-fit the sensor feed into the viewport and cropped the
      // overflow off-screen; the capture is the full frame. Cropping back to
      // the measured viewport aspect is what makes "captured" equal "framed".
      // Only this path — a gallery pick was never bound to a preview.
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
      capturingRef.current = false;
      setCapturing(false);
    }
  };

  // Auto-capture goes through the same function as the button — same guard,
  // same crop, same flow. One shutter implementation is what stops the
  // automatic path from quietly diverging from the manual fallback.
  //
  // Assigned in an effect with no dependency list (so it re-points after every
  // render, at the latest closure) rather than during render, which the
  // compiler rejects: a ref written mid-render can be read by a concurrent
  // render that then never commits.
  useEffect(() => {
    takePictureRef.current = () => void takePicture();
  });

  const pickImage = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;
    await startCaptureFlow(asset.uri, asset.width, asset.height);
  };

  /**
   * Per-field messages, rendered inline under each input.
   *
   * The sys ≤ dia case flags both fields: the message lives on `systolic` and
   * `diastolic` gets the empty-string companion flag, so the second field goes
   * red without repeating the sentence.
   */
  const validate = () => {
    const sys = Number(systolic);
    const dia = Number(diastolic);
    const hr = Number(pulse);
    const errors: { systolic?: string; diastolic?: string; pulse?: string } = {};

    if (!systolic.trim() || !Number.isFinite(sys)) errors.systolic = 'กรุณากรอกตัวเลข';
    else if (sys < BOUNDS.systolic.min || sys > BOUNDS.systolic.max) {
      errors.systolic = 'ค่าตัวบนควรอยู่ระหว่าง 50–250';
    }

    if (!diastolic.trim() || !Number.isFinite(dia)) errors.diastolic = 'กรุณากรอกตัวเลข';
    else if (dia < BOUNDS.diastolic.min || dia > BOUNDS.diastolic.max) {
      errors.diastolic = 'ค่าตัวล่างควรอยู่ระหว่าง 30–150';
    }

    if (!pulse.trim() || !Number.isFinite(hr)) errors.pulse = 'กรุณากรอกตัวเลข';
    else if (hr < BOUNDS.pulse.min || hr > BOUNDS.pulse.max) {
      errors.pulse = 'ชีพจรควรอยู่ระหว่าง 30–220';
    }

    if (!errors.systolic && !errors.diastolic && sys <= dia) {
      errors.systolic = 'ค่าตัวบนต้องมากกว่าตัวล่าง';
      errors.diastolic = '';
    }

    return errors;
  };

  const saveReading = async () => {
    setSaveError(null);

    if (!isAuthenticated) {
      setSaveError('กรุณาเข้าสู่ระบบก่อนบันทึกข้อมูล');
      return;
    }

    const errors = validate();
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
      await save({
        imageUri: capturedImage,
        systolic: sys,
        diastolic: dia,
        pulse: hr,
        // Capture time, not save time. An offline capture saved an hour later
        // must keep the moment the measurement was actually taken.
        measuredAt: capturedAtRef.current ?? new Date(),
        patientId: isCaregiver ? viewingPatientId : undefined,
      });
    } catch {
      setSaveError('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง');
      return;
    }

    // Dismiss the sheet before the alert, or the two stack as visible layers of
    // chrome — especially on Android.
    setShowEntryModal(false);

    const reading = classifyReading(sys, dia);
    const isAlarming = reading === 'elevated' || reading === 'high' || reading === 'critical';

    Alert.alert(
      isAlarming ? 'แจ้งเตือนความดัน' : 'บันทึกสำเร็จ',
      isAlarming
        ? `ผลของคุณ: ${statusLabel(reading)}\n\nคำแนะนำ: ${statusGuidance(reading)}`
        : reading === 'low'
          ? `ผลของคุณ: ${statusLabel(reading)}`
          : 'บันทึกค่าความดันเรียบร้อยแล้ว',
      [
        {
          text: 'ตกลง',
          onPress: () => {
            resetAll();
            router.back();
          },
        },
      ],
    );
  };

  const retryCamera = () => {
    setCameraMountError(null);
    setCameraKey((key) => key + 1);
    setCameraReady(false);
  };

  /**
   * Back to the camera, keeping whatever the user typed — asking them to
   * re-enter it on every retake would be punishing. `resetAll` is the hard
   * reset, for after a save.
   *
   * The framing gate is reset too: without it a retake resumes with the old
   * committed state and the auto-capture one-shot already spent, leaving the
   * user at a camera whose gate can never arm again.
   */
  const retake = () => {
    setCapturedImage(null);
    setShowEntryModal(false);
    setFieldErrors({});
    setSaveError(null);
    setOfflineCapture(false);
    capturedAtRef.current = null;
    resetFraming();
    resetAnalysis();
  };

  const resetAll = () => {
    retake();
    setSystolic('');
    setDiastolic('');
    setPulse('');
  };

  // The tab bar is visible on this route, so leaving is the back stack — and
  // the home tab when there is none, so nobody is stranded.
  const closeCamera = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const aiBusy = phase === 'uploading' || phase === 'queued' || phase === 'processing';
  const canAttemptSave =
    Boolean(capturedImage) && Boolean(systolic.trim() && diastolic.trim() && pulse.trim());
  const saveDisabled = isSaving || aiBusy || !canAttemptSave;
  const saveLabel = isSaving ? 'กำลังบันทึก...' : aiBusy ? 'กรุณารอสักครู่' : 'บันทึก';

  // Mirrors the geometry in `app/(tabs)/_layout.tsx`. Duplicated rather than
  // imported to keep this screen uncoupled from the navigator config — if those
  // numbers change there, change them here.
  const tabBarTotalHeight =
    (Platform.OS === 'ios' ? 60 : 62) + insets.bottom + (Platform.OS === 'ios' ? 2 : 4);
  const bottomOverlayPadding = tabBarTotalHeight + 14;

  const caption = Math.round(12 * fontScale);
  const body = Math.round(15 * fontScale);

  // ── Caregiver gate ────────────────────────────────────────────────────────
  // Before the permission gate, so the app never asks for a camera it cannot
  // use yet: a reading recorded with no patient selected has no attribution
  // target.
  if (isCaregiver && !viewingPatientId) {
    return (
      <GradientBackground>
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="mb-6 h-[120px] w-[120px] items-center justify-center rounded-full"
            style={{
              backgroundColor: isDark ? colors.surface : '#EDE7F6',
              borderWidth: isDark ? 1 : 0,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="people" size={56} color={palette.purple} />
          </View>
          <Text
            className="mb-3 text-center font-bold"
            style={{ color: colors['text-primary'], fontSize: Math.round(20 * fontScale) }}
          >
            เลือกผู้ป่วยก่อนถ่ายภาพ
          </Text>
          <Text
            className="mb-8 text-center leading-6"
            style={{ color: colors['text-secondary'], fontSize: body }}
          >
            คุณกำลังใช้โหมดผู้ดูแล กรุณาเลือกผู้ป่วยจากแถบด้านบน หรือหน้าจัดการผู้ป่วย
            ก่อนบันทึกค่าความดันแทนผู้ป่วย
          </Text>
          <GradientButton
            title="จัดการผู้ป่วย"
            onPress={() => router.push('/invitations')}
            icon={<Ionicons name="people-outline" size={18} color="white" />}
          />
        </View>
      </GradientBackground>
    );
  }

  // ── Permission gates ──────────────────────────────────────────────────────

  if (!permission) {
    return (
      <GradientBackground>
        <View className="flex-1 items-center justify-center">
          <Text style={{ color: colors['text-primary'], fontSize: Math.round(16 * fontScale) }}>
            กำลังโหลด...
          </Text>
        </View>
      </GradientBackground>
    );
  }

  if (!permission.granted) {
    return (
      <GradientBackground>
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="mb-6 h-[120px] w-[120px] items-center justify-center rounded-full"
            style={{
              backgroundColor: isDark ? colors.surface : colors['surface-muted'],
              borderWidth: isDark ? 1 : 0,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="camera-outline" size={64} color={palette.blue} />
          </View>
          <Text
            className="mb-3 font-bold"
            style={{ color: colors['text-primary'], fontSize: Math.round(24 * fontScale) }}
          >
            ต้องการสิทธิ์เข้าถึงกล้อง
          </Text>
          <Text
            className="mb-8 text-center leading-6"
            style={{ color: colors['text-secondary'], fontSize: body }}
          >
            {permission.canAskAgain === false
              ? 'ตอนนี้แอปยังใช้กล้องไม่ได้ กรุณาเปิดสิทธิ์กล้องจากหน้าการตั้งค่า'
              : 'แอปต้องการสิทธิ์ในการเข้าถึงกล้องเพื่อถ่ายภาพเครื่องวัดความดัน'}
          </Text>
          <GradientButton
            title={permission.canAskAgain === false ? 'เปิดการตั้งค่า' : 'อนุญาตใช้กล้อง'}
            onPress={() => void requestCameraPermission()}
          />
          {/* Recovery for the case where the grant landed but the camera
              surface never picked it up — a state desync after a hot reload, or
              an OS lifecycle quirk. */}
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
              className="font-semibold underline"
              style={{
                color: isDark ? palette.blueLight : palette.blueDeep,
                fontSize: Math.round(14 * fontScale),
              }}
            >
              ลองใช้กล้องอีกครั้ง
            </Text>
          </Pressable>
        </View>
      </GradientBackground>
    );
  }

  return (
    <GradientBackground safeArea={false}>
      <View className="relative flex-1">
        {!capturedImage ? (
          <View
            className="absolute inset-0 bg-black"
            // Measures the box the preview cover-fits into, which is what the
            // capture is cropped back to. See `viewportAspect`.
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              if (width > 0 && height > 0) viewportAspect.current = width / height;
            }}
          >
            {cameraMountError ? (
              <View className="absolute inset-0 items-center justify-center px-5">
                <View
                  className="w-full items-center rounded-2xl p-4"
                  style={{
                    backgroundColor: isDark ? 'rgba(26,22,50,0.95)' : 'rgba(255,255,255,0.95)',
                    borderWidth: isDark ? 1 : 0,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="alert-circle" size={26} color={statusColor.high} />
                  <Text
                    className="mt-2 font-extrabold"
                    style={{ color: colors['text-primary'], fontSize: Math.round(16 * fontScale) }}
                  >
                    กล้องใช้งานไม่ได้
                  </Text>
                  <Text
                    className="mt-1.5 text-center"
                    style={{
                      color: colors['text-secondary'],
                      fontSize: Math.round(13 * fontScale),
                    }}
                    numberOfLines={3}
                  >
                    {cameraMountError}
                  </Text>
                  <View className="mt-3 w-full flex-row gap-2.5">
                    <TapScale
                      onPress={retryCamera}
                      className="flex-1 overflow-hidden rounded-[14px]"
                      accessibilityRole="button"
                      accessibilityLabel="ลองเปิดกล้องใหม่"
                    >
                      <LinearGradient
                        colors={accent}
                        className="flex-row items-center justify-center py-3"
                      >
                        <Ionicons name="refresh" size={18} color="white" />
                        <Text className="ml-2 font-bold text-white" style={{ fontSize: caption }}>
                          ลองใหม่
                        </Text>
                      </LinearGradient>
                    </TapScale>
                    <TapScale
                      onPress={() => void Linking.openSettings()}
                      className="flex-1 overflow-hidden rounded-[14px]"
                      accessibilityRole="button"
                      accessibilityLabel="เปิดหน้าตั้งค่าสิทธิ์กล้อง"
                    >
                      <View
                        className="flex-row items-center justify-center border py-3"
                        style={{
                          backgroundColor: colors['surface-muted'],
                          borderColor: colors.border,
                        }}
                      >
                        <Ionicons name="settings" size={18} color={colors['text-primary']} />
                        <Text
                          className="ml-2 font-bold"
                          style={{ color: colors['text-primary'], fontSize: caption }}
                        >
                          ตั้งค่า
                        </Text>
                      </View>
                    </TapScale>
                  </View>
                </View>
              </View>
            ) : (
              <>
                <BpCameraView
                  key={cameraKey}
                  ref={cameraRef}
                  className="absolute inset-0"
                  liveDetection={!capturedImage && !cameraMountError}
                  onDetections={onFramingFrame}
                  onMountError={(event) =>
                    setCameraMountError(event.message || 'ไม่สามารถเปิดกล้องได้')
                  }
                  onCameraReady={() => setCameraReady(true)}
                />
                {!isCameraReady ? (
                  <View className="absolute inset-0 items-center justify-center">
                    <View className="flex-row items-center rounded-full bg-black/55 px-3.5 py-2.5">
                      <Ionicons name="time-outline" size={16} color="white" />
                      <Text
                        className="ml-2 font-semibold text-white"
                        style={{ fontSize: caption }}
                      >
                        กำลังเปิดกล้อง...
                      </Text>
                    </View>
                  </View>
                ) : null}
              </>
            )}

            {/* Close, and the auto-capture toggle. The toggle lives here rather
                than in settings because this is where the behaviour happens —
                someone surprised by the countdown can turn it off from the place
                they noticed it, without losing their framing. Hidden where there
                is no detector: it would toggle something that can never fire. */}
            <View
              className="absolute left-3 right-3 flex-row items-center"
              style={{ top: insets.top + 8 }}
            >
              <TapScale
                onPress={closeCamera}
                accessibilityRole="button"
                accessibilityLabel="ปิดหน้ากล้อง"
              >
                <View className="h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.12]">
                  <Ionicons name="close" size={22} color="white" />
                </View>
              </TapScale>
              <View className="flex-1" />
              {isLiveDetectionSupported() ? (
                <TapScale
                  onPress={() => void setAutoCapture(!autoCapture)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: autoCapture }}
                  accessibilityLabel="ถ่ายอัตโนมัติเมื่อจับภาพได้"
                >
                  <View
                    className="h-11 flex-row items-center rounded-full border px-3"
                    style={{
                      backgroundColor: autoCapture
                        ? 'rgba(39,174,96,0.25)'
                        : 'rgba(255,255,255,0.12)',
                      borderColor: autoCapture ? statusColor.normal : 'rgba(255,255,255,0.15)',
                    }}
                  >
                    <Ionicons
                      name={autoCapture ? 'flash' : 'flash-off'}
                      size={16}
                      color={autoCapture ? statusColor.normal : 'white'}
                    />
                    <Text className="ml-1.5 font-medium text-white" style={{ fontSize: caption }}>
                      อัตโนมัติ
                    </Text>
                  </View>
                </TapScale>
              ) : null}
            </View>

            {/* Tap-anywhere cancel — the largest possible target, which is what
                an unsteady hand needs while the countdown runs. Interactive only
                then, or it would swallow taps meant for the controls underneath.
                Centred within the space above the tab bar, so the visible bar
                does not pull the perceived centre downward. */}
            <Pressable
              className="absolute left-0 right-0 top-0"
              style={{ bottom: tabBarTotalHeight }}
              pointerEvents={isCountingDown ? 'auto' : 'none'}
              onPress={cancelAutoCapture}
              accessibilityRole="button"
              accessibilityLabel="ยกเลิกการถ่ายอัตโนมัติ"
            >
              <View className="flex-1 items-center justify-center">
                <View
                  className="mb-5 flex-row items-center rounded-2xl bg-black/60 px-4 py-2.5"
                  // Announce coaching changes, not frames — the state is
                  // already smoothed, so each change here is a real one.
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={
                    isCountingDown
                      ? 'พร้อมถ่ายแล้ว กำลังจะถ่ายอัตโนมัติ แตะเพื่อยกเลิก'
                      : FRAMING_PRESENTATION[framingState].label
                  }
                >
                  <Ionicons
                    name={FRAMING_PRESENTATION[framingState].icon}
                    size={18}
                    color={FRAMING_PRESENTATION[framingState].color}
                  />
                  <Text className="ml-2 font-medium text-white" style={{ fontSize: body }}>
                    {isCountingDown
                      ? 'พร้อมแล้ว · แตะเพื่อยกเลิก'
                      : FRAMING_PRESENTATION[framingState].label}
                  </Text>
                </View>

                {/* Corner brackets take the state colour. Colour alone never
                    carries the message — the pill above always says it in words
                    — but it is what makes the answer readable at a glance while
                    the user is looking at the monitor, not the text. */}
                <View className="relative aspect-square w-[75%]">
                  {(
                    [
                      'absolute top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-xl',
                      'absolute top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-xl',
                      'absolute bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-xl',
                      'absolute bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-xl',
                    ] as const
                  ).map((corner) => (
                    <View
                      key={corner}
                      className={'h-10 w-10 ' + corner}
                      style={{ borderColor: FRAMING_PRESENTATION[framingState].color }}
                    />
                  ))}
                  {/* Faint crosshair — guides the aim without obscuring the feed. */}
                  <View className="absolute left-1/2 top-1/2 -ml-4 -mt-px h-px w-8 bg-white/40" />
                  <View className="absolute left-1/2 top-1/2 -ml-px -mt-4 h-8 w-px bg-white/40" />
                </View>
              </View>
            </Pressable>

            {/* Controls. The bottom-up scrim keeps the white glyphs legible
                against a bright sensor feed. */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.55)']}
              className="absolute bottom-0 left-0 right-0 pt-10"
              style={{ paddingBottom: bottomOverlayPadding }}
            >
              <View className="flex-row items-center justify-between px-10">
                <TapScale
                  onPress={() => void pickImage()}
                  className="w-[70px] items-center"
                  accessibilityRole="button"
                  accessibilityLabel="เลือกรูปจากอัลบั้ม"
                >
                  <View className="h-[50px] w-[50px] items-center justify-center rounded-full border border-white/15 bg-white/[0.12]">
                    <Ionicons name="images" size={22} color="white" />
                  </View>
                  <Text className="mt-1.5 font-medium text-white" style={{ fontSize: caption }}>
                    แกลเลอรี่
                  </Text>
                </TapScale>

                {/* While the countdown runs, the shutter becomes the cancel — a
                    named target, which is what a screen reader can find. The
                    shutter itself is never blocked by the framing gate: a
                    detector false negative must not stop someone recording. */}
                <Pressable
                  onPress={isCountingDown ? cancelAutoCapture : () => void takePicture()}
                  disabled={isCapturing}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isCountingDown ? 'ยกเลิกการถ่ายอัตโนมัติ' : 'ถ่ายภาพเครื่องวัดความดัน'
                  }
                  accessibilityState={{ disabled: isCapturing, busy: isCapturing }}
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed && !isCapturing ? 0.95 : 1 }],
                    alignItems: 'center',
                  })}
                >
                  <View className="h-[88px] w-[88px] items-center justify-center rounded-full border-[3px] border-white/40">
                    {/* The ring is an overlay arc rather than an animation of
                        the button, so the shutter's size and position never
                        shift under the user's finger while it fills. */}
                    {isCountingDown ? (
                      <Svg
                        width={88}
                        height={88}
                        style={{ position: 'absolute', top: -3, left: -3 }}
                      >
                        <Circle
                          cx={44}
                          cy={44}
                          r={41}
                          stroke={statusColor.normal}
                          strokeWidth={4}
                          fill="none"
                          strokeLinecap="round"
                          // Starts at 12 o'clock and sweeps clockwise — the
                          // direction people read a timer.
                          transform="rotate(-90 44 44)"
                          strokeDasharray={2 * Math.PI * 41}
                          strokeDashoffset={2 * Math.PI * 41 * (1 - countdownProgress)}
                        />
                      </Svg>
                    ) : null}
                    <View
                      className="h-[72px] w-[72px] items-center justify-center rounded-full"
                      style={{ backgroundColor: isCapturing ? '#EBF5FB' : '#FFFFFF' }}
                    >
                      {isCapturing ? (
                        <ActivityIndicator size="small" color={palette.purpleDark} />
                      ) : (
                        <Ionicons
                          name={isCountingDown ? 'close' : 'camera'}
                          size={32}
                          color={palette.purpleDark}
                        />
                      )}
                    </View>
                  </View>
                  <Text
                    className="mt-1.5 text-center font-medium text-white"
                    style={{ fontSize: caption }}
                  >
                    {isCapturing ? 'กำลังถ่าย...' : isCountingDown ? 'ยกเลิก' : 'ถ่ายภาพ'}
                  </Text>
                </Pressable>

                <TapScale
                  onPress={() => setShowEntryModal(true)}
                  className="w-[70px] items-center"
                  accessibilityRole="button"
                  accessibilityLabel="กรอกค่าความดันด้วยตนเอง"
                >
                  <View className="h-[50px] w-[50px] items-center justify-center rounded-full border border-white/15 bg-white/[0.12]">
                    <Ionicons name="create" size={22} color="white" />
                  </View>
                  <Text className="mt-1.5 font-medium text-white" style={{ fontSize: caption }}>
                    กรอกค่า
                  </Text>
                </TapScale>
              </View>
            </LinearGradient>
          </View>
        ) : (
          /* The captured frame, full-screen to match the live branch.
             `contain`, not `cover`: the whole monitor has to stay visible so the
             user can eye-check it against the read before saving. */
          <View className="absolute inset-0 bg-black">
            <Image
              source={{ uri: capturedImage }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              contentFit="contain"
            />

            {phase !== 'idle' ? (
              <View className="absolute left-0 right-0 top-20 items-center">
                <View
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={PHASE_LABEL[phase]}
                  className="flex-row items-center gap-2 rounded-full border px-3.5 py-2"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: isDark ? colors.border : colors['surface-muted'],
                  }}
                >
                  <View
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        phase === 'done'
                          ? statusColor.normal
                          : phase === 'failed'
                            ? statusColor.high
                            : phase === 'queued'
                              ? statusColor.elevated
                              : palette.blue,
                    }}
                  />
                  <Text
                    className="font-semibold"
                    style={{
                      color: colors['text-primary'],
                      fontSize: Math.round(13 * fontScale),
                    }}
                  >
                    {PHASE_LABEL[phase]}
                  </Text>
                </View>

                {/* Skipped on `failed`: the recovery button below already says
                    that, and a bar frozen mid-way reads as "still working". */}
                {phase !== 'failed' ? (
                  <View
                    className="mt-2 h-1.5 w-40 overflow-hidden rounded-full"
                    style={{
                      backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                    }}
                  >
                    <Animated.View
                      style={{
                        height: '100%',
                        borderRadius: 999,
                        backgroundColor:
                          phase === 'done'
                            ? statusColor.normal
                            : phase === 'queued'
                              ? statusColor.elevated
                              : palette.blue,
                        width: progressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', '100%'],
                        }),
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.8)']}
              className="absolute bottom-0 left-0 right-0 px-4 pt-6"
              style={{ paddingBottom: bottomOverlayPadding }}
            >
              {/* A failed analysis gets an explicit way back to the camera and a
                  hard remount of the preview surface, so a stuck one does not
                  carry over into the next attempt. */}
              {phase === 'failed' ? (
                <View className="mb-3">
                  <TapScale
                    onPress={() => {
                      retake();
                      retryCamera();
                    }}
                    className="overflow-hidden rounded-2xl"
                    accessibilityRole="button"
                    accessibilityLabel="ลองใช้กล้องอีกครั้ง"
                  >
                    <View
                      className="flex-row items-center justify-center border px-5 py-3"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.95)',
                        borderColor: 'rgba(235,245,251,0.9)',
                      }}
                    >
                      <Ionicons name="camera-reverse" size={20} color={palette.blueDeep} />
                      <Text
                        className="ml-2 font-semibold"
                        style={{ color: palette.blueDeep, fontSize: body }}
                      >
                        ลองใช้กล้องอีกครั้ง
                      </Text>
                    </View>
                  </TapScale>
                </View>
              ) : null}

              {/* Retake is a calm neutral surface — red would read as "discard",
                  and the typed values survive a retake. Confirm is the brand
                  accent, the primary-action language used app-wide. */}
              <View className="flex-row justify-center gap-3">
                <TapScale
                  onPress={retake}
                  className="flex-1 overflow-hidden rounded-2xl"
                  accessibilityRole="button"
                  accessibilityLabel="ถ่ายภาพใหม่"
                >
                  <View
                    className="flex-row items-center justify-center border px-5 py-3.5"
                    style={{ backgroundColor: '#231C42', borderColor: '#2D2654' }}
                  >
                    <Ionicons name="refresh" size={20} color="#E8E4F5" />
                    <Text
                      className="ml-2 font-semibold"
                      style={{ color: '#E8E4F5', fontSize: body }}
                    >
                      ถ่ายใหม่
                    </Text>
                  </View>
                </TapScale>

                <TapScale
                  onPress={() => setShowEntryModal(true)}
                  className="flex-1 overflow-hidden rounded-2xl"
                  accessibilityRole="button"
                  accessibilityLabel="ยืนยันภาพและกรอกค่าความดัน"
                >
                  <LinearGradient
                    colors={accent}
                    className="flex-row items-center justify-center px-5 py-3.5"
                  >
                    <Ionicons name="checkmark" size={22} color="white" />
                    <Text className="ml-2 font-semibold text-white" style={{ fontSize: body }}>
                      ยืนยันภาพ
                    </Text>
                  </LinearGradient>
                </TapScale>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* ── Entry sheet ── */}
        <Modal
          visible={showEntryModal}
          transparent
          animationType="none"
          onRequestClose={() => setShowEntryModal(false)}
        >
          {/* Tap the scrim to dismiss; the sheet swallows its own taps so the
              form does not close under the user's finger. */}
          <Pressable
            onPress={() => setShowEntryModal(false)}
            className="flex-1 justify-end bg-black/45"
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={Platform.OS === 'ios' ? insets.bottom + 10 : 0}
              className="w-full flex-1 justify-end"
            >
              <Pressable
                onPress={() => {
                  /* swallow — a tap inside the sheet must not dismiss it */
                }}
                className={
                  'rounded-t-[22px] px-4 pt-2.5 ' + (Platform.OS === 'ios' ? 'pb-7' : 'pb-4')
                }
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: isDark ? 1 : 0,
                  borderColor: colors.border,
                }}
              >
                {/* Drag handle. Static — the scrim already dismisses; this is
                    the cue that it does. */}
                <View className="mb-2 items-center">
                  <View
                    className="h-1 w-10 rounded-full"
                    style={{ backgroundColor: isDark ? colors.border : '#CFE3EE' }}
                  />
                </View>

                <View className="mb-1.5 flex-row items-center justify-between">
                  <Text
                    className="font-semibold"
                    style={{
                      color: colors['text-primary'],
                      fontSize: Math.round(17 * fontScale),
                    }}
                  >
                    กรอกค่าความดัน
                  </Text>
                  <TapScale
                    onPress={() => setShowEntryModal(false)}
                    className="h-9 w-9 items-center justify-center rounded-xl"
                    style={{ backgroundColor: colors['surface-muted'] }}
                    accessibilityRole="button"
                    accessibilityLabel="ปิดหน้ากรอกค่าความดัน"
                  >
                    <Ionicons name="close" size={22} color={colors['icon-neutral']} />
                  </TapScale>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {/* Makes it explicit whose record this writes to, before the
                      button is pressed. */}
                  {activePatient ? (
                    <View
                      className="mb-2 flex-row items-center rounded-xl px-3 py-2"
                      style={{ backgroundColor: 'rgba(126,87,194,0.12)' }}
                    >
                      <Ionicons
                        name="people"
                        size={16}
                        color={palette.purple}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        className="flex-1 font-semibold"
                        style={{ color: palette.purple, fontSize: caption }}
                        numberOfLines={1}
                      >
                        บันทึกให้ คุณ {activePatient.firstname} {activePatient.lastname}
                      </Text>
                    </View>
                  ) : null}

                  <Text
                    className="mb-3"
                    style={{ color: colors['text-secondary'], fontSize: caption }}
                  >
                    {capturedImage
                      ? 'ตรวจสอบรูปแล้วกรอกค่า SYS / DIA / ชีพจร'
                      : 'ยังไม่มีรูป (ถ่ายรูปหรือเลือกรูปก่อน แล้วค่อยบันทึก)'}
                  </Text>

                  {/* Informative, never red: being offline is the case this app
                      is built for, not a failure. */}
                  {offlineCapture ? (
                    <View
                      accessibilityLiveRegion="polite"
                      className="mb-3 flex-row items-start rounded-xl px-3.5 py-3"
                      style={{
                        backgroundColor: 'rgba(53,184,232,0.12)',
                        borderWidth: 1,
                        borderColor: palette.blue,
                      }}
                    >
                      <Ionicons
                        name="cloud-offline-outline"
                        size={18}
                        color={isDark ? palette.blueLight : palette.blueDeep}
                        style={{ marginRight: 8, marginTop: 1 }}
                      />
                      <Text
                        className="flex-1 font-semibold"
                        style={{ color: isDark ? palette.blueLight : '#0E6E9E', fontSize: caption }}
                      >
                        ตอนนี้ออฟไลน์อยู่ กรอกค่าจากหน้าจอเครื่องวัดได้เลย
                        ระบบจะซิงก์ข้อมูลและรูปให้อัตโนมัติเมื่อกลับมาออนไลน์
                      </Text>
                    </View>
                  ) : null}

                  {saveError ? (
                    <View
                      accessibilityRole="alert"
                      accessibilityLiveRegion="assertive"
                      className="mb-3 flex-row items-center rounded-xl px-3.5 py-3"
                      style={{
                        backgroundColor: 'rgba(231,76,60,0.12)',
                        borderWidth: 1,
                        borderColor: statusColor.high,
                      }}
                    >
                      <Ionicons
                        name="alert-circle"
                        size={18}
                        color={statusColor.high}
                        style={{ marginRight: 8 }}
                      />
                      <Text
                        className="flex-1 font-semibold"
                        style={{ color: statusColor.high, fontSize: caption }}
                      >
                        {saveError}
                      </Text>
                    </View>
                  ) : null}

                  {/* The read produced values but was not sure. They are shown
                      for comparison rather than silently filled in — a wrong
                      number nobody noticed becomes a wrong number in a medical
                      history. */}
                  {lowConfidenceReadings ? (
                    <View
                      accessibilityLiveRegion="polite"
                      className="mb-3 rounded-xl px-3.5 py-3"
                      style={{
                        backgroundColor: 'rgba(243,156,18,0.12)',
                        borderWidth: 1,
                        borderColor: statusColor.elevated,
                      }}
                    >
                      <View className="mb-1 flex-row items-center">
                        <Ionicons
                          name="help-circle"
                          size={18}
                          color="#B97400"
                          style={{ marginRight: 8 }}
                        />
                        <Text
                          className="font-semibold"
                          style={{ color: '#7A4E00', fontSize: body }}
                        >
                          ช่วยตรวจสอบตัวเลขให้หน่อยนะคะ
                        </Text>
                      </View>
                      <Text
                        className="mb-3"
                        style={{ color: 'rgba(122,78,0,0.92)', fontSize: caption }}
                      >
                        {`ระบบไม่แน่ใจ (ความมั่นใจ ${lowConfidencePct}%) กรุณาเทียบกับหน้าจอเครื่องวัด`}
                      </Text>
                      <View className="flex-row gap-2">
                        <TapScale
                          onPress={() => {
                            applyReading(lowConfidenceReadings);
                            dismissLowConfidence();
                          }}
                          className="flex-1 overflow-hidden rounded-lg"
                          accessibilityRole="button"
                          accessibilityLabel="ใช้ค่าที่ระบบอ่านได้"
                        >
                          <LinearGradient colors={accent} className="items-center px-3 py-2">
                            <Text
                              className="font-semibold text-white"
                              style={{ fontSize: caption }}
                            >
                              ใช้ค่านี้
                            </Text>
                          </LinearGradient>
                        </TapScale>
                        <TapScale
                          onPress={dismissLowConfidence}
                          className="flex-1 overflow-hidden rounded-lg"
                          accessibilityRole="button"
                          accessibilityLabel="กรอกค่าด้วยตนเอง"
                        >
                          <View
                            className="items-center border px-3 py-2"
                            style={{
                              backgroundColor: '#FFF4E0',
                              borderColor: 'rgba(217,119,6,0.45)',
                            }}
                          >
                            <Text
                              className="font-semibold"
                              style={{ color: '#7A4E00', fontSize: caption }}
                            >
                              แก้เอง
                            </Text>
                          </View>
                        </TapScale>
                      </View>
                    </View>
                  ) : null}

                  <View className="flex-col gap-3">
                    <TextField
                      placeholder="SYS"
                      value={systolic}
                      onChangeText={(text) => {
                        setSystolic(text);
                        if (
                          fieldErrors.systolic !== undefined ||
                          fieldErrors.diastolic !== undefined
                        ) {
                          setFieldErrors((prev) => ({
                            ...prev,
                            systolic: undefined,
                            diastolic: undefined,
                          }));
                        }
                        if (saveError) setSaveError(null);
                      }}
                      icon="arrow-up"
                      keyboardType="numeric"
                      error={fieldErrors.systolic}
                    />
                    <TextField
                      placeholder="DIA"
                      value={diastolic}
                      onChangeText={(text) => {
                        setDiastolic(text);
                        if (
                          fieldErrors.diastolic !== undefined ||
                          fieldErrors.systolic !== undefined
                        ) {
                          setFieldErrors((prev) => ({
                            ...prev,
                            systolic: undefined,
                            diastolic: undefined,
                          }));
                        }
                        if (saveError) setSaveError(null);
                      }}
                      icon="arrow-down"
                      keyboardType="numeric"
                      error={fieldErrors.diastolic}
                    />
                    <TextField
                      placeholder="ชีพจร"
                      value={pulse}
                      onChangeText={(text) => {
                        setPulse(text);
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
                </ScrollView>

                <View className="mt-2 flex-row gap-3">
                  <TapScale
                    onPress={retake}
                    className="flex-1 overflow-hidden rounded-2xl"
                    accessibilityRole="button"
                    accessibilityLabel="ถ่ายภาพใหม่"
                  >
                    <View
                      className="flex-row items-center justify-center border py-3.5"
                      style={{
                        backgroundColor: colors['surface-muted'],
                        borderColor: colors.border,
                      }}
                    >
                      <Ionicons name="refresh" size={18} color={colors['text-primary']} />
                      <Text
                        className="ml-2 font-semibold"
                        style={{ color: colors['text-primary'], fontSize: body }}
                      >
                        ถ่ายใหม่
                      </Text>
                    </View>
                  </TapScale>

                  <TapScale
                    onPress={() => void saveReading()}
                    disabled={saveDisabled}
                    className="flex-1 overflow-hidden rounded-2xl"
                    accessibilityRole="button"
                    accessibilityLabel="บันทึกค่าความดัน"
                    accessibilityState={{ disabled: saveDisabled, busy: isSaving || aiBusy }}
                  >
                    {saveDisabled ? (
                      <View
                        className="flex-row items-center justify-center py-3.5"
                        style={{ backgroundColor: isDark ? colors.border : '#BDC3C7' }}
                      >
                        <Ionicons name="save" size={18} color="white" />
                        <Text className="ml-2 font-semibold text-white" style={{ fontSize: body }}>
                          {saveLabel}
                        </Text>
                      </View>
                    ) : (
                      <LinearGradient
                        colors={accent}
                        className="flex-row items-center justify-center py-3.5"
                      >
                        <Ionicons name="save" size={18} color="white" />
                        <Text className="ml-2 font-semibold text-white" style={{ fontSize: body }}>
                          บันทึก
                        </Text>
                      </LinearGradient>
                    )}
                  </TapScale>
                </View>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      </View>
    </GradientBackground>
  );
}
