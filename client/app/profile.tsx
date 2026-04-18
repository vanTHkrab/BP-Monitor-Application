import { CustomButton } from "@/components/custom-button";
import { CustomInput } from "@/components/custom-input";
import { GradientBackground } from "@/components/gradient-background";
import { Colors } from "@/constants/colors";
import { useAppStore } from "@/store/useAppStore";
import { getFontClass } from "@/utils/font-scale";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
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
    uploadMyAvatar,
    hideSensitiveData,
    sensitiveDataUnlocked,
    unlockSensitiveData,
  } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const headerIconColor =
    themePreference === "dark" ? "#E2E8F0" : Colors.text.primary;
  const isDark = themePreference === "dark";
  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: "text-lg",
    small: "text-xl",
    medium: "text-[22px]",
    large: "text-2xl",
    xlarge: "text-[28px]",
  });
  const bodyClassName = getFontClass(fontSizePreference, {
    xsmall: "text-xs",
    small: "text-sm",
    medium: "text-base",
    large: "text-lg",
    xlarge: "text-xl",
  });

  const [firstname, setFirstname] = useState(user?.firstname || "");
  const [lastname, setLastname] = useState(user?.lastname || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [email, setEmail] = useState(user?.email || "");
  const [dob, setDob] = useState(
    user?.dob ? user.dob.toISOString().slice(0, 10) : "",
  );
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
    }, [hideSensitiveData]),
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
      quality: 0.8,
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
      quality: 0.8,
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

    if (dob.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(dob.trim())) {
      Alert.alert("ข้อมูลไม่ถูกต้อง", "วันเกิดต้องอยู่ในรูปแบบ YYYY-MM-DD");
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

      if (avatar && avatar !== user.avatar && !/^https?:\/\//i.test(avatar)) {
        const okAvatar = await uploadMyAvatar(avatar);
        if (!okAvatar) {
          Alert.alert(
            "ข้อผิดพลาด",
            "บันทึกข้อมูลได้ แต่ไม่สามารถอัปโหลดรูปโปรไฟล์ได้",
          );
          setIsEditing(false);
          return;
        }
      }

      Alert.alert("สำเร็จ", "บันทึกข้อมูลเรียบร้อย");
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="relative flex-row items-center justify-center px-4 py-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="absolute left-4 p-1"
          >
            <Ionicons name="arrow-back" size={28} color={headerIconColor} />
          </TouchableOpacity>

          <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 text-center"}>
            โปรไฟล์ของฉัน
          </Text>

          {!isLocked ? (
            <TouchableOpacity
              onPress={() => setIsEditing(!isEditing)}
              className="absolute right-4 p-1"
            >
              <Text className={bodyClassName + " text-blue-500 font-medium"}>
                {isEditing ? "ยกเลิก" : "แก้ไข"}
              </Text>
            </TouchableOpacity>
          ) : (
            <View className="absolute right-4">
              <Ionicons
                name="lock-closed"
                size={22}
                color={isDark ? "#CBD5E1" : "#475569"}
              />
            </View>
          )}
        </View>

        {isLocked ? (
          <View className="px-4 mt-4">
            <View className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-sky-200 dark:border-slate-700">
              <View className="items-center mb-4">
                <View className="w-16 h-16 rounded-full bg-sky-100 dark:bg-slate-800 items-center justify-center mb-3">
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={30}
                    color={Colors.primary.blue}
                  />
                </View>
                <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100"}>
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
            <View className="items-center py-6">
              <TouchableOpacity
                onPress={isEditing ? openAvatarOptions : undefined}
                activeOpacity={isEditing ? 0.7 : 1}
              >
                <View className="w-28 h-28 rounded-full bg-white dark:bg-slate-900 overflow-hidden border-4 border-white dark:border-slate-700 shadow-lg">
                  {avatar ? (
                    <Image source={{ uri: avatar }} className="w-full h-full" />
                  ) : (
                    <View className="w-full h-full items-center justify-center bg-gray-200 dark:bg-slate-800">
                      <Ionicons
                        name="person"
                        size={48}
                        color={Colors.text.secondary}
                      />
                    </View>
                  )}
                </View>
                {isEditing && (
                  <View className="absolute bottom-0 right-0 w-8 h-8 bg-blue-500 rounded-full items-center justify-center">
                    <Ionicons name="camera" size={16} color="white" />
                  </View>
                )}
              </TouchableOpacity>
            </View>

            <View className="px-4">
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
              <CustomInput
                placeholder="วันเกิด YYYY-MM-DD"
                value={dob}
                onChangeText={setDob}
                icon="calendar-outline"
                editable={isEditing}
              />

              <View className="mb-4">
                <Text className={bodyClassName + " font-semibold text-gray-500 dark:text-slate-300 mb-2 ml-1"}>
                  เพศ
                </Text>
                <View className="flex-row">
                  {(["male", "female", "other"] as const).map((item, index) => {
                    const active = gender === item;
                    return (
                      <TouchableOpacity
                        key={item}
                        disabled={!isEditing}
                        onPress={() => setGender(item)}
                        className={
                          "flex-1 rounded-[14px] border-2 py-3 items-center " +
                          (active
                            ? "border-[#5DADE2] bg-[#EBF5FB]"
                            : isDark
                              ? "border-[#334155] bg-[#0B1220]"
                              : "border-[#94A3B8] bg-[#F8FAFC]") +
                          (index === 1 ? " mx-2" : "") +
                          (!isEditing ? " opacity-70" : "")
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
                  })}
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

              {isEditing && (
                <View className="mt-4">
                  <CustomButton
                    title="บันทึก"
                    onPress={handleSave}
                    loading={isSaving}
                  />
                </View>
              )}
            </View>
          </>
        )}

        {!isLocked && (
          <View className="px-4 mt-8">
            <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 mb-4"}>
              สถิติของคุณ
            </Text>
            <View className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-transparent dark:border-slate-700">
              <View className="flex-row justify-between py-2 border-b border-gray-100 dark:border-slate-700">
                <Text className={bodyClassName + " text-gray-600 dark:text-slate-300"}>
                  จำนวนการวัดทั้งหมด
                </Text>
                <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                  {stats.totalReadings} ครั้ง
                </Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-100 dark:border-slate-700">
                <Text className={bodyClassName + " text-gray-600 dark:text-slate-300"}>
                  วันที่เริ่มใช้งาน
                </Text>
                <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                  {stats.joinedDate}
                </Text>
              </View>
              <View className="flex-row justify-between py-2">
                <Text className={bodyClassName + " text-gray-600 dark:text-slate-300"}>
                  ค่าเฉลี่ยความดัน
                </Text>
                <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                  {stats.averageText}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View className="h-8" />
      </ScrollView>
    </GradientBackground>
  );
}
