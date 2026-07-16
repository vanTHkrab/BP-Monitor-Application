import { CustomButton } from "@/components/custom-button";
import { CustomInput } from "@/components/custom-input";
import { GradientBackground } from "@/components/gradient-background";
import { Avatar } from "@/components/ui/avatar";
import { Colors, Theme } from "@/constants/colors";
import { UserRole } from "@/types";
import { useAppStore } from "@/store/use-app-store";
import { formatIsoDate, isValidIsoDate, parseIsoDate } from "@/utils/date";
import { fontPresetClass } from "@/utils/font-scale";
import { useFocusEffect } from "@react-navigation/native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Href, router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const formatDate = (date?: Date) => {
  if (!date) return "-";

  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const genderLabel: Record<"male" | "female" | "other", string> = {
  male: "ชาย",
  female: "หญิง",
  other: "อื่นๆ",
};

// Role identity for the hero badge. Colors come from the palette tokens so the
// badge stays on-brand across themes.
const roleMeta: Record<
  UserRole,
  { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }
> = {
  patient: { label: "ผู้ป่วย", icon: "person", color: Colors.primary.blue },
  caregiver: { label: "ผู้ดูแล", icon: "people", color: Colors.secondary.purple },
  developer: { label: "นักพัฒนา", icon: "construct", color: Colors.accent.orange },
};

const BIOMETRIC_PREF_KEY = "bp.biometric_enabled";
const PROFILE_RELOCK_MS = 30_000;

let lastProfileLeaveAt: number | null = null;

const getBiometricErrorMessage = (error?: string) => {
  switch (error) {
    case "authentication_failed":
      return "Face ID / Touch ID ไม่ผ่าน กรุณาลองสแกนใหม่อีกครั้ง";
    case "user_cancel":
      return "ยกเลิกการยืนยันตัวตน";
    case "system_cancel":
      return "ระบบยกเลิกการยืนยันตัวตน กรุณาลองใหม่";
    case "app_cancel":
      return "แอปยกเลิกการยืนยันตัวตน";
    case "not_available":
      return "อุปกรณ์ยังไม่พร้อมสำหรับ Face ID / Touch ID ในแอปนี้";
    case "not_enrolled":
      return "อุปกรณ์ยังไม่ได้ตั้งค่า Face ID / Touch ID";
    case "passcode_not_set":
      return "ยังไม่ได้ตั้งรหัสผ่านของเครื่อง";
    case "lockout":
      return "Face ID / Touch ID ถูกล็อกชั่วคราว กรุณาปลดล็อกเครื่องก่อน";
    case "no_space":
      return "ระบบยืนยันตัวตนของอุปกรณ์มีปัญหาเรื่องพื้นที่จัดเก็บ";
    case "timeout":
      return "หมดเวลาในการยืนยันตัวตน กรุณาลองใหม่";
    default:
      return error
        ? `ยืนยันตัวตนไม่สำเร็จ (${error})`
        : "ยืนยันตัวตนไม่สำเร็จ กรุณาลองอีกครั้ง";
  }
};

export default function ProfileScreen() {
  const {
    user,
    readings,
    updateMyProfile,
    fetchMyProfile,
    uploadMyAvatar,
    hideSensitiveData,
    sensitiveDataUnlocked,
    unlockSensitiveData,
    myPatients,
    fetchMyPatients,
  } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const headerIconColor =
    themePreference === "dark" ? Theme.dark.iconNeutral : Colors.text.primary;
  const isDark = themePreference === "dark";
  const titleClassName = fontPresetClass.title(fontSizePreference);
  const nameClassName = fontPresetClass.subtitle(fontSizePreference);
  const sectionClassName = fontPresetClass.cardTitle(fontSizePreference);
  const bodyClassName = fontPresetClass.body(fontSizePreference);
  const captionClassName = fontPresetClass.caption(fontSizePreference);

  const role = user?.role;
  const roleInfo = role ? roleMeta[role] : null;
  const isCaregiver = role === "caregiver";
  const fullName =
    [user?.firstname, user?.lastname].filter(Boolean).join(" ").trim() || "ผู้ใช้งาน";

  const [firstname, setFirstname] = useState(user?.firstname || "");
  const [lastname, setLastname] = useState(user?.lastname || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [email, setEmail] = useState(user?.email || "");
  const [dob, setDob] = useState(
    user?.dob ? user.dob.toISOString().slice(0, 10) : "",
  );
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [gender, setGender] = useState<"male" | "female" | "other" | "">(
    user?.gender || "",
  );
  const [weight, setWeight] = useState(user?.weight ? String(user.weight) : "");
  const [height, setHeight] = useState(user?.height ? String(user.height) : "");
  const [congenitalDisease, setCongenitalDisease] = useState(
    user?.congenitalDisease || "",
  );
  const [avatar, setAvatar] = useState(user?.avatar || "");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const isLocked = hideSensitiveData && !sensitiveDataUnlocked;

  const handleDobChange = (event: DateTimePickerEvent, selected?: Date) => {
    // Android shows a modal dialog the OS dismisses on any action, so we close
    // here; the iOS spinner is inline and stays open until "เสร็จสิ้น".
    if (Platform.OS !== "ios") setShowDobPicker(false);
    if (event.type === "dismissed") return;
    if (selected) setDob(formatIsoDate(selected));
  };

  useEffect(() => {
    setFirstname(user?.firstname || "");
    setLastname(user?.lastname || "");
    setPhone(user?.phone || "");
    setEmail(user?.email || "");
    setDob(user?.dob ? user.dob.toISOString().slice(0, 10) : "");
    setGender(user?.gender || "");
    setWeight(user?.weight ? String(user.weight) : "");
    setHeight(user?.height ? String(user.height) : "");
    setCongenitalDisease(user?.congenitalDisease || "");
    setAvatar(user?.avatar || "");
  }, [user]);

  useEffect(() => {
    const hydrateBiometric = async () => {
      const [storedPref, hasHardware, isEnrolled] = await Promise.all([
        SecureStore.getItemAsync(BIOMETRIC_PREF_KEY),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      setBiometricEnabled(storedPref === "true");
      setBiometricAvailable(hasHardware && isEnrolled);
    };

    void hydrateBiometric();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void fetchMyProfile();
      // Caregivers see a linked-patients summary in the hero — keep its count
      // fresh on focus (no-op / cheap for non-caregivers we still guard).
      if (isCaregiver) void fetchMyPatients();

      if (
        hideSensitiveData &&
        lastProfileLeaveAt &&
        Date.now() - lastProfileLeaveAt > PROFILE_RELOCK_MS
      ) {
        useAppStore.getState().lockSensitiveData();
      }

      return () => {
        lastProfileLeaveAt = Date.now();
      };
    }, [fetchMyProfile, fetchMyPatients, hideSensitiveData, isCaregiver]),
  );

  const stats = useMemo(() => {
    const totalReadings = readings.length;
    const averageSystolic =
      totalReadings > 0
        ? Math.round(
            readings.reduce((sum, reading) => sum + reading.systolic, 0) /
              totalReadings,
          )
        : null;
    const averageDiastolic =
      totalReadings > 0
        ? Math.round(
            readings.reduce((sum, reading) => sum + reading.diastolic, 0) /
              totalReadings,
          )
        : null;

    return {
      totalReadings,
      averageText:
        averageSystolic !== null && averageDiastolic !== null
          ? `${averageSystolic}/${averageDiastolic} mmHg`
          : "-",
      joinedDate: formatDate(user?.createdAt),
    };
  }, [readings, user?.createdAt]);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "ต้องการสิทธิ์",
        "กรุณาอนุญาตการเข้าถึงรูปภาพเพื่อเลือกรูปโปรไฟล์",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.65,
    });

    if (!result.canceled && result.assets[0]) {
      setAvatar(result.assets[0].uri);
    }
  };

  const captureImage = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "ต้องการสิทธิ์",
        "กรุณาอนุญาตการเข้าถึงกล้องเพื่อถ่ายรูปโปรไฟล์",
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.65,
    });

    if (!result.canceled && result.assets[0]) {
      setAvatar(result.assets[0].uri);
    }
  };

  const openAvatarOptions = () => {
    Alert.alert("เลือกรูปโปรไฟล์", "กรุณาเลือกวิธีการ", [
      { text: "ถ่ายภาพ", onPress: () => void captureImage() },
      { text: "เลือกรูปจากแกลเลอรี", onPress: () => void pickImage() },
      { text: "ยกเลิก", style: "cancel" },
    ]);
  };

  const handleUnlock = async () => {
    if (!unlockPassword.trim()) {
      Alert.alert("กรอกรหัสผ่าน", "กรุณากรอกรหัสผ่านก่อนปลดล็อกข้อมูลส่วนตัว");
      return;
    }

    setIsUnlocking(true);
    try {
      const ok = await unlockSensitiveData(unlockPassword);
      if (!ok) {
        Alert.alert(
          "ปลดล็อกไม่สำเร็จ",
          "รหัสผ่านไม่ถูกต้องหรือเซิร์ฟเวอร์ไม่พร้อมใช้งาน",
        );
        return;
      }
      setUnlockPassword("");
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleBiometricUnlock = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "ยืนยันตัวตนเพื่อดูข้อมูลส่วนตัว",
      cancelLabel: "ยกเลิก",
      disableDeviceFallback: true,
    });

    if (!result.success) {
      Alert.alert(
        "ยืนยันตัวตนไม่สำเร็จ",
        getBiometricErrorMessage(result.error),
      );
      return;
    }

    useAppStore.setState({ sensitiveDataUnlocked: true });
  };

  const handleSave = async () => {
    if (!user) {
      Alert.alert("กรุณาเข้าสู่ระบบ", "ต้องเข้าสู่ระบบก่อนแก้ไขโปรไฟล์");
      return;
    }

    if (!firstname.trim() || !lastname.trim() || !phone.trim()) {
      Alert.alert("ข้อมูลไม่ครบ", "กรุณากรอกชื่อ นามสกุล และเบอร์โทรศัพท์");
      return;
    }

    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert("ข้อมูลไม่ถูกต้อง", "รูปแบบอีเมลไม่ถูกต้อง");
      return;
    }

    if (dob.trim() && !isValidIsoDate(dob.trim())) {
      Alert.alert("ข้อมูลไม่ถูกต้อง", "วันเกิดไม่ถูกต้อง (รูปแบบ YYYY-MM-DD เช่น 2000-01-31)");
      return;
    }

    const parsedWeight = weight.trim() ? Number(weight) : undefined;
    const parsedHeight = height.trim() ? Number(height) : undefined;

    if (
      weight.trim() &&
      (!Number.isFinite(parsedWeight) || parsedWeight! <= 0)
    ) {
      Alert.alert("ข้อมูลไม่ถูกต้อง", "น้ำหนักต้องเป็นตัวเลขมากกว่า 0");
      return;
    }

    if (
      height.trim() &&
      (!Number.isFinite(parsedHeight) || parsedHeight! <= 0)
    ) {
      Alert.alert("ข้อมูลไม่ถูกต้อง", "ส่วนสูงต้องเป็นตัวเลขมากกว่า 0");
      return;
    }

    setIsSaving(true);
    try {
      const okInfo = await updateMyProfile({
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        dob: dob.trim() || undefined,
        gender: gender || undefined,
        weight: parsedWeight,
        height: parsedHeight,
        congenitalDisease: congenitalDisease.trim() || undefined,
      });

      if (!okInfo) {
        Alert.alert("ข้อผิดพลาด", "ไม่สามารถบันทึกข้อมูลโปรไฟล์ได้");
        return;
      }

      // Avatar goes through the offline queue (auth.slice → upload-image).
      // The call is optimistic: it persists the pick in SQLite and the sync
      // mutex flushes whenever the device is online, so a network hiccup at
      // save-time no longer loses the picked photo.
      if (avatar && avatar !== user.avatar && !/^https?:\/\//i.test(avatar)) {
        await uploadMyAvatar(avatar);
      }

      Alert.alert("สำเร็จ", "บันทึกข้อมูลเรียบร้อย");
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const subtleIconColor = isDark ? Theme.dark.textSecondary : Colors.text.secondary;

  // Read-only info rows (edit fields are the form below). Name lives in the
  // hero, so it isn't repeated here.
  const infoRows: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
  }[] = [
    { icon: "call-outline", label: "เบอร์โทรศัพท์", value: user?.phone || "-" },
    { icon: "mail-outline", label: "อีเมล", value: user?.email || "-" },
    {
      icon: "calendar-outline",
      label: "วันเกิด",
      value: user?.dob ? formatDate(user.dob) : "-",
    },
    {
      icon: "male-female-outline",
      label: "เพศ",
      value: user?.gender
        ? genderLabel[user.gender as keyof typeof genderLabel] ?? user.gender
        : "-",
    },
    {
      icon: "barbell-outline",
      label: "น้ำหนัก",
      value: user?.weight ? `${user.weight} กก.` : "-",
    },
    {
      icon: "resize-outline",
      label: "ส่วนสูง",
      value: user?.height ? `${user.height} ซม.` : "-",
    },
    {
      icon: "medkit-outline",
      label: "โรคประจำตัว",
      value: user?.congenitalDisease || "-",
    },
  ];

  const statRows: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
  }[] = [
    {
      icon: "pulse-outline",
      label: "จำนวนการวัดทั้งหมด",
      value: `${stats.totalReadings} ครั้ง`,
    },
    {
      icon: "trending-up-outline",
      label: "ค่าเฉลี่ยความดัน",
      value: stats.averageText,
    },
    {
      icon: "time-outline",
      label: "วันที่เริ่มใช้งาน",
      value: stats.joinedDate,
    },
  ];

  return (
    <GradientBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header bar */}
          <View className="relative flex-row items-center justify-center px-4 py-4">
            <TouchableOpacity
              onPress={() => router.back()}
              className="absolute left-4 p-1"
              accessibilityRole="button"
              accessibilityLabel="ย้อนกลับ"
            >
              <Ionicons name="arrow-back" size={28} color={headerIconColor} />
            </TouchableOpacity>

            <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 text-center"}>
              โปรไฟล์ของฉัน
            </Text>

            {!isLocked ? (
              <TouchableOpacity
                onPress={() => setIsEditing(!isEditing)}
                className="absolute right-4 flex-row items-center px-2 py-1"
                accessibilityRole="button"
                accessibilityLabel={isEditing ? "ยกเลิกการแก้ไข" : "แก้ไขโปรไฟล์"}
              >
                <Ionicons
                  name={isEditing ? "close" : "create-outline"}
                  size={18}
                  color={Colors.primary.blue}
                />
                <Text className={bodyClassName + " text-blue-500 font-semibold ml-1"}>
                  {isEditing ? "ยกเลิก" : "แก้ไข"}
                </Text>
              </TouchableOpacity>
            ) : (
              <View className="absolute right-4">
                <Ionicons
                  name="lock-closed"
                  size={22}
                  color={subtleIconColor}
                />
              </View>
            )}
          </View>

          {isLocked ? (
            <View className="px-4 mt-4">
              <View className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-white/70 dark:border-slate-700 shadow-lg shadow-black/10">
                <View className="items-center mb-5">
                  <View className="w-16 h-16 rounded-full bg-sky-100 dark:bg-slate-800 items-center justify-center mb-3">
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={30}
                      color={Colors.primary.blue}
                    />
                  </View>
                  <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 text-center"}>
                    ข้อมูลส่วนตัวถูกซ่อนอยู่
                  </Text>
                  <Text className={bodyClassName + " text-center text-gray-500 dark:text-slate-300 mt-2"}>
                    กรุณากรอกรหัสผ่านปัจจุบันเพื่อดูและแก้ไขข้อมูลส่วนตัว
                  </Text>
                </View>

                <CustomInput
                  placeholder="รหัสผ่านปัจจุบัน"
                  value={unlockPassword}
                  onChangeText={setUnlockPassword}
                  icon="lock-closed-outline"
                  secureTextEntry
                />

                <CustomButton
                  title="ปลดล็อกข้อมูลส่วนตัว"
                  onPress={handleUnlock}
                  loading={isUnlocking}
                />

                {biometricEnabled && biometricAvailable && (
                  <View className="mt-3">
                    <CustomButton
                      title="ปลดล็อกด้วยลายนิ้วมือ / Face ID"
                      onPress={() => void handleBiometricUnlock()}
                      variant="outline"
                    />
                  </View>
                )}
              </View>
            </View>
          ) : (
            <>
              {/* Hero: avatar + name + role */}
              <View className="px-4">
                <View className="items-center rounded-3xl bg-white dark:bg-slate-900 border border-white/70 dark:border-slate-700 shadow-lg shadow-black/10 px-5 pt-6 pb-6">
                  <TouchableOpacity
                    onPress={isEditing ? openAvatarOptions : undefined}
                    activeOpacity={isEditing ? 0.7 : 1}
                    accessibilityRole={isEditing ? "button" : "image"}
                    accessibilityLabel={
                      isEditing ? "เปลี่ยนรูปโปรไฟล์" : `รูปโปรไฟล์ของ ${fullName}`
                    }
                  >
                    <Avatar
                      uri={avatar}
                      name={fullName}
                      size="xl"
                      className="border-4 border-white dark:border-slate-700 shadow-lg"
                    />
                    {isEditing && (
                      <View
                        className="absolute bottom-0 right-0 w-9 h-9 rounded-full items-center justify-center border-2 border-white dark:border-slate-900"
                        style={{ backgroundColor: Colors.primary.blue }}
                      >
                        <Ionicons name="camera" size={16} color="white" />
                      </View>
                    )}
                  </TouchableOpacity>

                  <Text
                    className={nameClassName + " font-bold text-gray-800 dark:text-slate-100 mt-4 text-center"}
                    numberOfLines={2}
                  >
                    {fullName}
                  </Text>

                  {roleInfo && (
                    <View
                      className="flex-row items-center rounded-full px-3 py-1 mt-2.5"
                      style={{ backgroundColor: roleInfo.color + "1A" }}
                    >
                      <Ionicons name={roleInfo.icon} size={14} color={roleInfo.color} />
                      <Text
                        className={captionClassName + " font-bold ml-1.5"}
                        style={{ color: roleInfo.color }}
                      >
                        {roleInfo.label}
                      </Text>
                    </View>
                  )}

                  {isEditing && (
                    <Text className={captionClassName + " text-gray-400 dark:text-slate-500 mt-3 text-center"}>
                      แตะรูปเพื่อเปลี่ยนรูปโปรไฟล์
                    </Text>
                  )}
                </View>
              </View>

              {/* Caregiver: linked-patients summary */}
              {isCaregiver && (
                <View className="px-4 mt-4">
                  <TouchableOpacity
                    onPress={() => router.push("/caregivers" as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={`ผู้ป่วยในการดูแล ${myPatients.length} คน แตะเพื่อจัดการ`}
                    className="flex-row items-center rounded-2xl bg-white dark:bg-slate-900 border border-white/70 dark:border-slate-700 px-4 py-3.5 shadow-md shadow-black/5"
                  >
                    <View
                      className="w-11 h-11 rounded-full items-center justify-center"
                      style={{ backgroundColor: Colors.secondary.purple + "1A" }}
                    >
                      <Ionicons name="people" size={22} color={Colors.secondary.purple} />
                    </View>
                    <View className="flex-1 ml-3">
                      <Text className={sectionClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                        ผู้ป่วยในการดูแล
                      </Text>
                      <Text className={captionClassName + " text-gray-500 dark:text-slate-400 mt-0.5"}>
                        {myPatients.length > 0
                          ? `${myPatients.length} คน`
                          : "ยังไม่มีผู้ป่วยที่เชื่อมโยง"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={subtleIconColor} />
                  </TouchableOpacity>
                </View>
              )}

              {/* Personal info */}
              <View className="px-4 mt-6">
                <Text className={sectionClassName + " font-bold text-gray-700 dark:text-slate-200 mb-3 ml-1"}>
                  ข้อมูลส่วนตัว
                </Text>

                {isEditing ? (
                  <View>
                    <CustomInput
                      placeholder="ชื่อ"
                      value={firstname}
                      onChangeText={setFirstname}
                      icon="person-outline"
                      editable={isEditing}
                    />
                    <CustomInput
                      placeholder="นามสกุล"
                      value={lastname}
                      onChangeText={setLastname}
                      icon="person-outline"
                      editable={isEditing}
                    />
                    <CustomInput
                      placeholder="เบอร์โทรศัพท์"
                      value={phone}
                      onChangeText={setPhone}
                      icon="call-outline"
                      keyboardType="phone-pad"
                      editable={isEditing}
                    />
                    <CustomInput
                      placeholder="อีเมล"
                      value={email}
                      onChangeText={setEmail}
                      icon="mail-outline"
                      keyboardType="email-address"
                      editable={isEditing}
                    />
                    {/* The native date picker has no react-native-web build, so
                        web keeps the plain field; native taps the field to open
                        the OS picker. */}
                    {Platform.OS === "web" ? (
                      <CustomInput
                        placeholder="วันเกิด YYYY-MM-DD"
                        value={dob}
                        onChangeText={setDob}
                        icon="calendar-outline"
                        editable={isEditing}
                      />
                    ) : (
                      <Pressable onPress={() => setShowDobPicker(true)}>
                        {/* editable=false → the Pressable owns the tap and opens
                            the native picker instead of the keyboard */}
                        <CustomInput
                          placeholder="วันเกิด"
                          value={dob}
                          onChangeText={setDob}
                          icon="calendar-outline"
                          editable={false}
                        />
                      </Pressable>
                    )}

                    {Platform.OS !== "web" && showDobPicker && (
                      <>
                        <DateTimePicker
                          value={parseIsoDate(dob) ?? new Date(2000, 0, 1)}
                          mode="date"
                          // iOS renders the wheel inline; Android shows a dialog
                          display={Platform.OS === "ios" ? "spinner" : "default"}
                          maximumDate={new Date()}
                          onChange={handleDobChange}
                        />
                        {Platform.OS === "ios" && (
                          <Pressable
                            onPress={() => setShowDobPicker(false)}
                            className="self-end mb-4 px-4 py-2"
                          >
                            <Text className={bodyClassName + " font-semibold text-[#7E57C2]"}>
                              เสร็จสิ้น
                            </Text>
                          </Pressable>
                        )}
                      </>
                    )}

                    <View className="mb-4">
                      <Text className={bodyClassName + " font-semibold text-gray-500 dark:text-slate-300 mb-2 ml-1"}>
                        เพศ
                      </Text>
                      <View className="flex-row">
                        {(["male", "female", "other"] as const).map(
                          (item, index) => {
                            const active = gender === item;
                            return (
                              <TouchableOpacity
                                key={item}
                                onPress={() => setGender(item)}
                                accessibilityRole="button"
                                accessibilityLabel={`เพศ ${genderLabel[item]}`}
                                accessibilityState={{ selected: active }}
                                className={
                                  "flex-1 rounded-[14px] border-2 py-3 items-center " +
                                  (active
                                    ? "border-[#5DADE2] bg-[#EBF5FB]"
                                    : isDark
                                      ? "border-[#334155] bg-[#0B1220]"
                                      : "border-[#94A3B8] bg-[#F8FAFC]") +
                                  (index === 1 ? " mx-2" : "")
                                }
                              >
                                <Text
                                  className={
                                    active
                                      ? "text-[#3498DB] font-bold"
                                      : isDark
                                        ? "text-slate-300 font-semibold"
                                        : "text-slate-600 font-semibold"
                                  }
                                >
                                  {genderLabel[item]}
                                </Text>
                              </TouchableOpacity>
                            );
                          },
                        )}
                      </View>
                    </View>

                    <View className="flex-row">
                      <View className="flex-1">
                        <CustomInput
                          placeholder="น้ำหนัก (กก.)"
                          value={weight}
                          onChangeText={setWeight}
                          icon="barbell-outline"
                          keyboardType="numeric"
                          editable={isEditing}
                        />
                      </View>
                      <View className="w-3" />
                      <View className="flex-1">
                        <CustomInput
                          placeholder="ส่วนสูง (ซม.)"
                          value={height}
                          onChangeText={setHeight}
                          icon="resize-outline"
                          keyboardType="numeric"
                          editable={isEditing}
                        />
                      </View>
                    </View>

                    <CustomInput
                      placeholder="โรคประจำตัว"
                      value={congenitalDisease}
                      onChangeText={setCongenitalDisease}
                      icon="medkit-outline"
                      editable={isEditing}
                    />

                    <View className="mt-4">
                      <CustomButton
                        title="บันทึก"
                        onPress={handleSave}
                        loading={isSaving}
                      />
                    </View>
                  </View>
                ) : (
                  <View className="rounded-2xl bg-white dark:bg-slate-900 border border-white/70 dark:border-slate-700 overflow-hidden shadow-md shadow-black/5">
                    {infoRows.map((row, index) => (
                      <View
                        key={row.label}
                        className={
                          "flex-row items-center px-4 py-3.5 " +
                          (index < infoRows.length - 1
                            ? "border-b border-gray-100 dark:border-slate-800"
                            : "")
                        }
                      >
                        <Ionicons name={row.icon} size={18} color={subtleIconColor} />
                        <Text className={captionClassName + " text-gray-500 dark:text-slate-400 ml-3"}>
                          {row.label}
                        </Text>
                        <Text
                          className={bodyClassName + " font-semibold text-gray-800 dark:text-slate-100 ml-auto pl-3 text-right flex-shrink"}
                          numberOfLines={2}
                          accessibilityRole="text"
                        >
                          {row.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Reading overview */}
              <View className="px-4 mt-6">
                <Text className={sectionClassName + " font-bold text-gray-700 dark:text-slate-200 mb-3 ml-1"}>
                  ภาพรวมการวัด
                </Text>
                <View className="rounded-2xl bg-white dark:bg-slate-900 border border-white/70 dark:border-slate-700 overflow-hidden shadow-md shadow-black/5">
                  {statRows.map((row, index) => (
                    <View
                      key={row.label}
                      className={
                        "flex-row items-center px-4 py-3.5 " +
                        (index < statRows.length - 1
                          ? "border-b border-gray-100 dark:border-slate-800"
                          : "")
                      }
                    >
                      <View
                        className="w-9 h-9 rounded-full items-center justify-center"
                        style={{ backgroundColor: Colors.primary.blue + "1A" }}
                      >
                        <Ionicons name={row.icon} size={18} color={Colors.primary.blue} />
                      </View>
                      <Text className={bodyClassName + " text-gray-600 dark:text-slate-300 ml-3"}>
                        {row.label}
                      </Text>
                      <Text
                        className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100 ml-auto pl-3 text-right"}
                        accessibilityRole="text"
                      >
                        {row.value}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBackground>
  );
}
