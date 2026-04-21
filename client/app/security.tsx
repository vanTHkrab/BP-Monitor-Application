import { CustomButton } from "@/components/custom-button";
import { CustomInput } from "@/components/custom-input";
import { GradientBackground } from "@/components/gradient-background";
import { MenuItem } from "@/components/menu-item";
import { Colors } from "@/constants/colors";
import { useAppStore } from "@/store/useAppStore";
import { getFontClass } from "@/utils/font-scale";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const BIOMETRIC_PREF_KEY = "bp.biometric_enabled";

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
    case "timeout":
      return "หมดเวลาในการยืนยันตัวตน กรุณาลองใหม่";
    default:
      return error
        ? `ยืนยันตัวตนไม่สำเร็จ (${error})`
        : "ยืนยันตัวตนไม่สำเร็จ กรุณาลองอีกครั้ง";
  }
};

export default function SecurityScreen() {
  const {
    hideSensitiveData,
    setHideSensitiveData,
    changePassword,
    clearAuthError,
    sessions,
    fetchSessions,
    logoutAllDevices,
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
  const captionClassName = getFontClass(fontSizePreference, {
    xsmall: "text-[11px]",
    small: "text-xs",
    medium: "text-sm",
    large: "text-base",
    xlarge: "text-lg",
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Biometric");

  useEffect(() => {
    const hydrate = async () => {
      const [hardware, enrolled, supportedTypes, storedPref] =
        await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync(),
          SecureStore.getItemAsync(BIOMETRIC_PREF_KEY),
        ]);

      const supported = hardware && enrolled;
      setBiometricSupported(supported);
      setBiometricEnabled(supported && storedPref === "true");

      if (
        supportedTypes.includes(
          LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
        )
      ) {
        setBiometricLabel("Face ID / ใบหน้า");
      } else if (
        supportedTypes.includes(
          LocalAuthentication.AuthenticationType.FINGERPRINT,
        )
      ) {
        setBiometricLabel("ลายนิ้วมือ");
      }

      void fetchSessions();
    };

    void hydrate();
  }, [fetchSessions]);

  const recentSessions = useMemo(() => sessions.slice(0, 5), [sessions]);

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert("ข้อมูลไม่ครบ", "กรุณากรอกรหัสผ่านให้ครบทุกช่อง");
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert("ข้อมูลไม่ถูกต้อง", "รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert("ข้อมูลไม่ถูกต้อง", "ยืนยันรหัสผ่านใหม่ไม่ตรงกัน");
      return;
    }

    setIsSavingPassword(true);
    clearAuthError();
    try {
      const ok = await changePassword(currentPassword, newPassword);
      if (!ok) {
        const { authErrorMessage } = useAppStore.getState();
        Alert.alert(
          "เปลี่ยนรหัสผ่านไม่สำเร็จ",
          authErrorMessage || "กรุณาลองใหม่",
        );
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      Alert.alert("สำเร็จ", "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว");
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleToggleBiometric = async (enabled: boolean) => {
    if (!enabled) {
      await SecureStore.setItemAsync(BIOMETRIC_PREF_KEY, "false");
      setBiometricEnabled(false);
      return;
    }

    if (!biometricSupported) {
      Alert.alert(
        "ยังไม่รองรับ",
        "อุปกรณ์นี้ยังไม่ได้ตั้งค่า biometric หรือไม่รองรับฟีเจอร์นี้",
      );
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "ยืนยันตัวตนเพื่อเปิดใช้งาน biometric",
      cancelLabel: "ยกเลิก",
      disableDeviceFallback: true,
    });

    if (!result.success) {
      Alert.alert(
        "ยังไม่เปิดใช้งาน biometric",
        getBiometricErrorMessage(result.error),
      );
      return;
    }

    await SecureStore.setItemAsync(BIOMETRIC_PREF_KEY, "true");
    setBiometricEnabled(true);
  };

  const handleLogoutAllDevices = () => {
    Alert.alert(
      "ออกจากระบบทุกอุปกรณ์",
      "ต้องการออกจากระบบทุกอุปกรณ์อื่นใช่หรือไม่? อุปกรณ์ปัจจุบันจะยังใช้งานต่อได้",
      [
        { text: "ยกเลิก", style: "cancel" },
        {
          text: "ยืนยัน",
          style: "destructive",
          onPress: async () => {
            const ok = await logoutAllDevices();
            if (!ok) {
              const { authErrorMessage } = useAppStore.getState();
              Alert.alert(
                "ไม่สำเร็จ",
                authErrorMessage || "ไม่สามารถออกจากระบบทุกอุปกรณ์ได้",
              );
              return;
            }
            Alert.alert("สำเร็จ", "ออกจากระบบทุกอุปกรณ์อื่นเรียบร้อยแล้ว");
          },
        },
      ],
    );
  };

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center px-4 py-4">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Ionicons name="arrow-back" size={28} color={headerIconColor} />
          </TouchableOpacity>
          <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 flex-1 text-center"}>
            ความปลอดภัย
          </Text>
          <View className="w-7" />
        </View>

        <View className="px-4">
          <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3"}>
            ปกป้องข้อมูลส่วนตัว
          </Text>

          <View className="flex-row items-center bg-white dark:bg-slate-900 p-4 rounded-xl mb-3 border border-sky-200 dark:border-slate-700">
            <View className="w-10 h-10 bg-sky-100 dark:bg-slate-800 rounded-full items-center justify-center mr-3">
              <Ionicons
                name="eye-off-outline"
                size={22}
                color={Colors.primary.blue}
              />
            </View>
            <View className="flex-1">
              <Text className={bodyClassName + " text-gray-800 dark:text-slate-100 font-medium"}>
                ซ่อนข้อมูลส่วนตัว
              </Text>
              <Text className={bodyClassName + " text-gray-500 dark:text-slate-300"}>
                ต้องยืนยันตัวตนอีกครั้งเมื่อกลับมาเปิดหน้าโปรไฟล์
              </Text>
            </View>
            <Switch
              value={hideSensitiveData}
              onValueChange={(value) => void setHideSensitiveData(value)}
              trackColor={{ false: "#D1D5DB", true: Colors.primary.skyBlue }}
              thumbColor={hideSensitiveData ? Colors.primary.blue : "#f4f3f4"}
            />
          </View>

          <View className="flex-row items-center bg-white dark:bg-slate-900 p-4 rounded-xl mb-3 border border-sky-200 dark:border-slate-700">
            <View className="w-10 h-10 bg-sky-100 dark:bg-slate-800 rounded-full items-center justify-center mr-3">
              <Ionicons
                name="finger-print-outline"
                size={22}
                color={Colors.primary.blue}
              />
            </View>
            <View className="flex-1">
              <Text className={bodyClassName + " text-gray-800 dark:text-slate-100 font-medium"}>
                ปลดล็อกด้วย {biometricLabel}
              </Text>
              <Text className={bodyClassName + " text-gray-500 dark:text-slate-300"}>
                {biometricSupported
                  ? "พร้อมใช้งานบนอุปกรณ์นี้"
                  : "อุปกรณ์ยังไม่ได้ตั้งค่า biometric หรือไม่รองรับ"}
              </Text>
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={(value) => void handleToggleBiometric(value)}
              trackColor={{ false: "#D1D5DB", true: Colors.primary.skyBlue }}
              thumbColor={biometricEnabled ? Colors.primary.blue : "#f4f3f4"}
            />
          </View>

          <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3 mt-6"}>
            เปลี่ยนรหัสผ่าน
          </Text>

          <View className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-sky-200 dark:border-slate-700">
            <CustomInput
              placeholder="รหัสผ่านปัจจุบัน"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              icon="lock-closed-outline"
              secureTextEntry
            />

            <CustomInput
              placeholder="รหัสผ่านใหม่"
              value={newPassword}
              onChangeText={setNewPassword}
              icon="key-outline"
              secureTextEntry
            />

            <CustomInput
              placeholder="ยืนยันรหัสผ่านใหม่"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              icon="shield-checkmark-outline"
              secureTextEntry
            />

            <CustomButton
              title="บันทึกรหัสผ่านใหม่"
              onPress={handleChangePassword}
              loading={isSavingPassword}
            />
          </View>

          <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3 mt-6"}>
            เซสชันการใช้งาน
          </Text>

          <MenuItem
            icon="log-out-outline"
            title="ออกจากระบบทุกอุปกรณ์"
            onPress={handleLogoutAllDevices}
            variant="danger"
          />

          <View className="bg-white dark:bg-slate-900 rounded-xl p-4 mt-3 border border-sky-200 dark:border-slate-700">
            <View className="flex-row items-center justify-between mb-3">
              <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                ประวัติการเข้าสู่ระบบล่าสุด
              </Text>
              <TouchableOpacity onPress={() => void fetchSessions()}>
                <Ionicons
                  name="refresh"
                  size={20}
                  color={Colors.primary.blue}
                />
              </TouchableOpacity>
            </View>

            {recentSessions.length > 0 ? (
              recentSessions.map((session) => (
                <View
                  key={session.id}
                  className="py-3 border-b border-gray-100 dark:border-slate-700"
                >
                  <Text className={bodyClassName + " font-semibold text-gray-800 dark:text-slate-100"}>
                    {session.deviceLabel || "Unknown Device"}
                  </Text>
                  <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1"}>
                    เข้าใช้ล่าสุด:{" "}
                    {new Date(session.lastActiveAt).toLocaleString("th-TH")}
                  </Text>
                  <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1"}>
                    สถานะ: {session.isActive ? "กำลังใช้งาน" : "ออกจากระบบแล้ว"}
                  </Text>
                </View>
              ))
            ) : (
              <Text className={bodyClassName + " text-gray-500 dark:text-slate-300"}>
                ยังไม่มีข้อมูล session
              </Text>
            )}
          </View>

          <View className="bg-blue-50 dark:bg-slate-900 rounded-xl p-4 border border-blue-200 dark:border-slate-700 mt-6">
            <View className="flex-row items-center mb-2">
              <Ionicons
                name="shield-checkmark"
                size={24}
                color={Colors.primary.blue}
              />
              <Text className={bodyClassName + " text-blue-800 dark:text-slate-100 font-bold ml-2"}>
                สถานะความปลอดภัย
              </Text>
            </View>
            <Text className={bodyClassName + " text-blue-700 dark:text-slate-300 leading-6"}>
              หน้านี้รองรับการซ่อนข้อมูลส่วนตัว, เปลี่ยนรหัสผ่าน, biometric
              unlock, ดู session ล่าสุด และสั่งออกจากทุกอุปกรณ์อื่นแล้ว
            </Text>
          </View>
        </View>

        <View className="h-8" />
      </ScrollView>
    </GradientBackground>
  );
}
