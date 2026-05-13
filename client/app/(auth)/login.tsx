import { FadeInView, ScaleOnMount } from "@/components/animated-components";
import { CustomButton } from "@/components/custom-button";
import { CustomInput } from "@/components/custom-input";
import { GradientBackground } from "@/components/gradient-background";
import { TabButtons } from "@/components/tab-buttons";
import { useAppStore } from "@/store/use-app-store";
import { getFontClass } from "@/utils/font-scale";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Href, router } from "expo-router";
import { cssInterop } from "nativewind";
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";

cssInterop(LinearGradient, { className: "style" });

export default function LoginScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const { login, clearAuthError } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === "dark";

  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: "text-[24px]",
    small: "text-[26px]",
    medium: "text-[28px]",
    large: "text-[30px]",
    xlarge: "text-[34px]",
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
    medium: "text-[13px]",
    large: "text-sm",
    xlarge: "text-base",
  });

  const handleLogin = async () => {
    if (!loginPhone || !loginPassword) {
      Alert.alert("ข้อผิดพลาด", "กรุณากรอกข้อมูลให้ครบถ้วน");
      return;
    }

    setIsLoading(true);
    try {
      clearAuthError();
      const success = await login(loginPhone, loginPassword);
      if (success) {
        router.replace("/(tabs)" as Href);
      } else {
        const { authErrorCode, authErrorMessage, authErrorRawMessage } =
          useAppStore.getState();
        const detail = [
          authErrorMessage || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
          authErrorCode ? `(${authErrorCode})` : null,
          authErrorRawMessage ? authErrorRawMessage : null,
        ]
          .filter(Boolean)
          .join("\n");
        Alert.alert("ข้อผิดพลาด", detail);
      }
    } catch {
      Alert.alert("ข้อผิดพลาด", "เกิดข้อผิดพลาดในการเข้าสู่ระบบ");
    } finally {
      setIsLoading(false);
    }
  };

  const authTabs = [
    { key: "login", label: "เข้าสู่ระบบ" },
    { key: "register", label: "ลงทะเบียน" },
  ];

  const authCardClassName =
    "rounded-3xl p-6 border shadow-xl " +
    (isDark
      ? "bg-[#1E293B] border-[#334155] shadow-black/40"
      : "bg-white border-[#E2E8F0] shadow-black/10");

  return (
    <GradientBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1 px-6 pt-6">
            {/* Logo */}
            <ScaleOnMount delay={100}>
              <View className="items-center mb-8">
                <LinearGradient
                  colors={
                    isDark ? ["#1E293B", "#0F172A"] : ["#FFFFFF", "#F0F7FF"]
                  }
                  className={
                    "w-[120px] h-[120px] rounded-full items-center justify-center mb-4 shadow-xl " +
                    (isDark ? "shadow-[#5DADE2]/30" : "shadow-black/15")
                  }
                >
                  <View className="items-center justify-center relative">
                    <Ionicons name="heart-circle" size={64} color="#E91E63" />
                    <View className="absolute -bottom-2 -right-4">
                      <Ionicons name="pulse" size={32} color="#5DADE2" />
                    </View>
                  </View>
                </LinearGradient>
                <Text
                  className={
                    isDark
                      ? `${titleClassName} font-bold text-white mb-1`
                      : `${titleClassName} font-bold text-[#2C3E50] mb-1`
                  }
                >
                  BP Monitor
                </Text>
                <Text
                  className={
                    isDark
                      ? `${bodyClassName} text-slate-300`
                      : `${bodyClassName} text-[#7F8C8D]`
                  }
                >
                  ติดตามความดันโลหิตอย่างง่ายดาย
                </Text>
              </View>
            </ScaleOnMount>

            {/* Login Card */}
            <FadeInView delay={200}>
              <View className={authCardClassName}>
                <View className="mb-6">
                  <TabButtons
                    tabs={authTabs}
                    activeTab="login"
                    onTabChange={(key) => {
                      if (key === "register") {
                        router.replace("/register" as Href);
                      }
                    }}
                    variant="default"
                  />
                </View>

                <CustomInput
                  placeholder="เบอร์โทรศัพท์"
                  value={loginPhone}
                  onChangeText={setLoginPhone}
                  icon="person-outline"
                  keyboardType="phone-pad"
                />

                <CustomInput
                  placeholder="รหัสผ่าน"
                  value={loginPassword}
                  onChangeText={setLoginPassword}
                  icon="lock-closed-outline"
                  secureTextEntry
                />

                <CustomButton
                  title="เข้าสู่ระบบ"
                  onPress={handleLogin}
                  loading={isLoading}
                  size="large"
                />
              </View>
            </FadeInView>
          </View>

          {/* Footer */}
          <FadeInView delay={400}>
            <View className="py-6">
              <Text className={`text-center text-white ${captionClassName}`}>
                Copyright©2025 BP Monitor App
              </Text>
            </View>
          </FadeInView>
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBackground>
  );
}
