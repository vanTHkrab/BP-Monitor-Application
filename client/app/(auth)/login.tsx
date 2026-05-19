import { FadeInView, ScaleOnMount } from "@/components/animated-components";
import { CustomButton } from "@/components/custom-button";
import { CustomInput } from "@/components/custom-input";
import { GradientBackground } from "@/components/gradient-background";
import { TabButtons } from "@/components/tab-buttons";
import { useAppStore } from "@/src/store/use-app-store";
import { getFontClass } from "@/src/utils/font-scale";
import { formatThaiPhone, stripPhoneDigits } from "@/src/utils/phone-format";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Href, router } from "expo-router";
import { cssInterop } from "nativewind";
import { useEffect, useRef, useState } from "react";
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Text,
    View,
} from "react-native";

cssInterop(LinearGradient, { className: "style" });

const formatCountdown = (sec: number) => {
  if (sec >= 60) {
    const minutes = Math.ceil(sec / 60);
    return `${minutes} นาที`;
  }
  return `${sec} วินาที`;
};

export default function LoginScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(
    undefined,
  );
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [retryAfterSec, setRetryAfterSec] = useState<number | null>(null);
  const retryDeadlineRef = useRef<number | null>(null);

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

  // Drive the rate-limit countdown off a wall-clock deadline so it stays
  // accurate even if JS gets backgrounded between ticks.
  useEffect(() => {
    if (retryAfterSec === null) {
      retryDeadlineRef.current = null;
      return;
    }
    if (retryDeadlineRef.current === null) {
      retryDeadlineRef.current = Date.now() + retryAfterSec * 1000;
    }
    const id = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil(((retryDeadlineRef.current ?? 0) - Date.now()) / 1000),
      );
      if (remaining <= 0) {
        retryDeadlineRef.current = null;
        setRetryAfterSec(null);
        setGeneralError(null);
      } else {
        setRetryAfterSec(remaining);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [retryAfterSec]);

  const clearAllErrors = () => {
    setPhoneError(undefined);
    setPasswordError(undefined);
    setGeneralError(null);
  };

  const onPhoneChange = (text: string) => {
    setLoginPhone(formatThaiPhone(text));
    if (phoneError !== undefined) setPhoneError(undefined);
    if (generalError) setGeneralError(null);
  };

  const onPasswordChange = (text: string) => {
    setLoginPassword(text);
    if (passwordError !== undefined) setPasswordError(undefined);
    if (generalError) setGeneralError(null);
  };

  const validate = (): { phone: string } | null => {
    const phone = stripPhoneDigits(loginPhone);
    let ok = true;
    if (!phone) {
      setPhoneError("กรุณากรอกเบอร์โทรศัพท์");
      ok = false;
    } else if (!/^\d{9,10}$/.test(phone)) {
      setPhoneError("เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก");
      ok = false;
    }
    if (!loginPassword) {
      setPasswordError("กรุณากรอกรหัสผ่าน");
      ok = false;
    }
    return ok ? { phone } : null;
  };

  const handleLogin = async () => {
    if (retryAfterSec !== null) return;
    clearAllErrors();
    const validated = validate();
    if (!validated) return;

    setIsLoading(true);
    try {
      clearAuthError();
      const ok = await login(validated.phone, loginPassword);
      if (ok) {
        router.replace("/(tabs)" as Href);
        return;
      }

      const s = useAppStore.getState();
      const message = s.authErrorMessage ?? "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่";

      if (s.authErrorRetryAfterSec !== null) {
        retryDeadlineRef.current = null;
        setRetryAfterSec(s.authErrorRetryAfterSec);
        setGeneralError(message);
        return;
      }

      switch (s.authErrorField) {
        case "phone":
          setPhoneError(message);
          break;
        case "password":
          setPasswordError(message);
          break;
        case "both":
          // Highlight both inputs with the same red border; show the
          // message once under the password field (the more common
          // cause) instead of duplicating it.
          setPhoneError("");
          setPasswordError(message);
          break;
        default:
          setGeneralError(message);
      }
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

  const bannerClassName =
    "flex-row items-start rounded-2xl p-3 mb-4 border " +
    (isDark
      ? "bg-[#3F1D1D] border-[#7F1D1D]"
      : "bg-red-50 border-red-200");

  const isThrottled = retryAfterSec !== null && retryAfterSec > 0;
  const submitDisabled = isLoading || isThrottled;
  const submitTitle = isThrottled
    ? `รอ ${formatCountdown(retryAfterSec ?? 0)}`
    : "เข้าสู่ระบบ";

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

                {generalError && (
                  <View className={bannerClassName}>
                    <Ionicons
                      name="alert-circle"
                      size={20}
                      color="#EF4444"
                      style={{ marginTop: 1, marginRight: 8 }}
                    />
                    <Text
                      className={
                        captionClassName +
                        " flex-1 font-semibold " +
                        (isDark ? "text-red-300" : "text-red-700")
                      }
                    >
                      {generalError}
                    </Text>
                  </View>
                )}

                <CustomInput
                  placeholder="เบอร์โทรศัพท์"
                  value={loginPhone}
                  onChangeText={onPhoneChange}
                  icon="person-outline"
                  keyboardType="phone-pad"
                  error={phoneError}
                />

                <CustomInput
                  placeholder="รหัสผ่าน"
                  value={loginPassword}
                  onChangeText={onPasswordChange}
                  icon="lock-closed-outline"
                  secureTextEntry
                  error={passwordError}
                />

                <CustomButton
                  title={submitTitle}
                  onPress={handleLogin}
                  loading={isLoading}
                  disabled={submitDisabled}
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
