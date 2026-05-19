import { FadeInView, ScaleOnMount } from "@/components/animated-components";
import { CustomButton } from "@/components/custom-button";
import { CustomInput } from "@/components/custom-input";
import { GradientBackground } from "@/components/gradient-background";
import { TabButtons } from "@/components/tab-buttons";
import { useAppStore } from "@/src/store/use-app-store";
import { getFontClass } from "@/src/utils/font-scale";
import { formatThaiPhone, stripPhoneDigits } from "@/src/utils/phone-format";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Href, router } from "expo-router";
import { cssInterop } from "nativewind";
import { useState } from "react";
import {
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";

cssInterop(LinearGradient, { className: "style" });

type RegisterField =
  | "firstname"
  | "lastname"
  | "phone"
  | "email"
  | "dob"
  | "weight"
  | "height"
  | "password"
  | "confirmPassword";

type FieldErrors = Partial<Record<RegisterField, string>>;

export default function RegisterScreen() {
  const [isLoading, setIsLoading] = useState(false);

  const [registerFirstname, setRegisterFirstname] = useState("");
  const [registerLastname, setRegisterLastname] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerDob, setRegisterDob] = useState("");
  const [registerGender, setRegisterGender] = useState<
    "male" | "female" | "other" | ""
  >("");
  const [registerWeight, setRegisterWeight] = useState("");
  const [registerHeight, setRegisterHeight] = useState("");
  const [registerCongenitalDisease, setRegisterCongenitalDisease] =
    useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registerAvatarUri, setRegisterAvatarUri] = useState<string | null>(
    null,
  );

  const [errors, setErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const { register, clearAuthError } = useAppStore();
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

  const clearFieldError = (field: RegisterField) => {
    setErrors((prev) => {
      if (prev[field] === undefined) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const bindInput =
    (field: RegisterField, setter: (v: string) => void) => (text: string) => {
      setter(text);
      clearFieldError(field);
      if (generalError) setGeneralError(null);
    };

  const pickRegisterAvatar = async () => {
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
      setRegisterAvatarUri(result.assets[0].uri);
    }
  };

  const captureRegisterAvatar = async () => {
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
      setRegisterAvatarUri(result.assets[0].uri);
    }
  };

  const openRegisterAvatarOptions = () => {
    Alert.alert("เลือกรูปโปรไฟล์", "กรุณาเลือกวิธีการ", [
      { text: "ถ่ายภาพ", onPress: () => void captureRegisterAvatar() },
      { text: "เลือกรูปจากแกลเลอรี", onPress: () => void pickRegisterAvatar() },
      { text: "ยกเลิก", style: "cancel" },
    ]);
  };

  // Returns the validated form payload, or null when any field is invalid.
  // All inline errors are populated via setErrors before returning null.
  const validate = (): {
    firstname: string;
    lastname: string;
    phone: string;
    email: string;
    dob: string;
    weight?: number;
    height?: number;
  } | null => {
    const next: FieldErrors = {};
    const firstname = registerFirstname.trim();
    const lastname = registerLastname.trim();
    const phone = stripPhoneDigits(registerPhone);
    const email = registerEmail.trim();
    const dob = registerDob.trim();
    const weightStr = registerWeight.trim();
    const heightStr = registerHeight.trim();

    if (!firstname) next.firstname = "กรุณากรอกชื่อ";
    if (!lastname) next.lastname = "กรุณากรอกนามสกุล";

    if (!phone) {
      next.phone = "กรุณากรอกเบอร์โทรศัพท์";
    } else if (!/^\d{9,10}$/.test(phone)) {
      next.phone = "เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก";
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = "รูปแบบอีเมลไม่ถูกต้อง";
    }

    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      next.dob = "วันเกิดต้องอยู่ในรูปแบบ YYYY-MM-DD";
    }

    let weight: number | undefined;
    if (weightStr) {
      const n = Number(weightStr);
      if (!Number.isFinite(n) || n <= 0) {
        next.weight = "น้ำหนักต้องเป็นตัวเลขมากกว่า 0";
      } else {
        weight = n;
      }
    }

    let height: number | undefined;
    if (heightStr) {
      const n = Number(heightStr);
      if (!Number.isFinite(n) || n <= 0) {
        next.height = "ส่วนสูงต้องเป็นตัวเลขมากกว่า 0";
      } else {
        height = n;
      }
    }

    if (!registerPassword) {
      next.password = "กรุณากรอกรหัสผ่าน";
    } else if (registerPassword.length < 8) {
      next.password = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
    }

    if (!confirmPassword) {
      next.confirmPassword = "กรุณายืนยันรหัสผ่าน";
    } else if (registerPassword && confirmPassword !== registerPassword) {
      next.confirmPassword = "รหัสผ่านไม่ตรงกัน";
    }

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return null;
    }

    return { firstname, lastname, phone, email, dob, weight, height };
  };

  const handleRegister = async () => {
    setErrors({});
    setGeneralError(null);
    const validated = validate();
    if (!validated) return;

    setIsLoading(true);
    try {
      clearAuthError();
      const ok = await register({
        firstname: validated.firstname,
        lastname: validated.lastname,
        phone: validated.phone,
        password: registerPassword,
        email: validated.email || undefined,
        dob: validated.dob || undefined,
        gender: registerGender || undefined,
        weight: validated.weight,
        height: validated.height,
        congenitalDisease: registerCongenitalDisease.trim() || undefined,
        avatarUri: registerAvatarUri,
      });

      if (ok) {
        router.replace("/(tabs)" as Href);
        return;
      }

      const s = useAppStore.getState();
      const message =
        s.authErrorMessage ?? "ไม่สามารถลงทะเบียนได้ กรุณาลองใหม่";
      switch (s.authErrorField) {
        case "phone":
          setErrors({ phone: message });
          break;
        case "password":
          setErrors({ password: message });
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

  const genderOptions: {
    key: "male" | "female" | "other";
    label: string;
  }[] = [
    { key: "male", label: "ชาย" },
    { key: "female", label: "หญิง" },
    { key: "other", label: "อื่นๆ" },
  ];

  const authCardClassName =
    "rounded-3xl p-6 border shadow-xl " +
    (isDark
      ? "bg-[#1E293B] border-[#334155] shadow-black/40"
      : "bg-white border-[#E2E8F0] shadow-black/10");

  const avatarBoxClassName =
    "w-[90px] h-[90px] rounded-full overflow-hidden items-center justify-center border-4 shadow-md " +
    (isDark
      ? "bg-[#0F172A] border-[#334155] shadow-black/40"
      : "bg-[#F9FAFB] border-[#E2E8F0] shadow-black/10");

  const bannerClassName =
    "flex-row items-start rounded-2xl p-3 mb-4 border " +
    (isDark
      ? "bg-[#3F1D1D] border-[#7F1D1D]"
      : "bg-red-50 border-red-200");

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

            {/* Register Card */}
            <FadeInView delay={200}>
              <View className={authCardClassName}>
                <View className="mb-6">
                  <TabButtons
                    tabs={authTabs}
                    activeTab="register"
                    onTabChange={(key) => {
                      if (key === "login") {
                        router.replace("/login" as Href);
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

                <View className="items-center mb-4">
                  <Pressable
                    onPress={openRegisterAvatarOptions}
                    className="items-center"
                  >
                    <View className={avatarBoxClassName}>
                      {registerAvatarUri ? (
                        <Image
                          source={{ uri: registerAvatarUri }}
                          className="w-full h-full"
                        />
                      ) : (
                        <Ionicons
                          name="person"
                          size={40}
                          color={isDark ? "#64748B" : "#94A3B8"}
                        />
                      )}
                    </View>
                    <Text
                      className={
                        captionClassName + " text-[#3498DB] font-bold mt-3"
                      }
                    >
                      {registerAvatarUri
                        ? "เปลี่ยนรูปโปรไฟล์"
                        : "เพิ่มรูปโปรไฟล์"}
                    </Text>
                  </Pressable>
                </View>

                <CustomInput
                  placeholder="ชื่อ"
                  value={registerFirstname}
                  onChangeText={bindInput("firstname", setRegisterFirstname)}
                  icon="person-outline"
                  error={errors.firstname}
                />

                <CustomInput
                  placeholder="นามสกุล"
                  value={registerLastname}
                  onChangeText={bindInput("lastname", setRegisterLastname)}
                  icon="person-outline"
                  error={errors.lastname}
                />

                <CustomInput
                  placeholder="เบอร์โทรศัพท์"
                  value={registerPhone}
                  onChangeText={bindInput("phone", (text) =>
                    setRegisterPhone(formatThaiPhone(text)),
                  )}
                  icon="call-outline"
                  keyboardType="phone-pad"
                  error={errors.phone}
                />

                <CustomInput
                  placeholder="อีเมล (ไม่บังคับ)"
                  value={registerEmail}
                  onChangeText={bindInput("email", setRegisterEmail)}
                  icon="mail-outline"
                  keyboardType="email-address"
                  error={errors.email}
                />

                <CustomInput
                  placeholder="วันเกิด YYYY-MM-DD (ไม่บังคับ)"
                  value={registerDob}
                  onChangeText={bindInput("dob", setRegisterDob)}
                  icon="calendar-outline"
                  error={errors.dob}
                />

                <View className="mb-4">
                  <Text
                    className={
                      isDark
                        ? `${captionClassName} font-semibold text-slate-300 mb-2 ml-1`
                        : `${captionClassName} font-semibold text-[#64748B] mb-2 ml-1`
                    }
                  >
                    เพศ (ไม่บังคับ)
                  </Text>
                  <View className="flex-row">
                    {genderOptions.map((option, index) => {
                      const active = registerGender === option.key;
                      return (
                        <Pressable
                          key={option.key}
                          onPress={() => setRegisterGender(option.key)}
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
                              `${captionClassName} ` +
                              (active
                                ? "text-[#3498DB] font-bold"
                                : isDark
                                  ? "text-slate-300 font-semibold"
                                  : "text-slate-600 font-semibold")
                            }
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View className="flex-row">
                  <View className="flex-1">
                    <CustomInput
                      placeholder="น้ำหนัก (กก.)"
                      value={registerWeight}
                      onChangeText={bindInput("weight", setRegisterWeight)}
                      icon="barbell-outline"
                      keyboardType="numeric"
                      error={errors.weight}
                    />
                  </View>
                  <View className="w-3" />
                  <View className="flex-1">
                    <CustomInput
                      placeholder="ส่วนสูง (ซม.)"
                      value={registerHeight}
                      onChangeText={bindInput("height", setRegisterHeight)}
                      icon="resize-outline"
                      keyboardType="numeric"
                      error={errors.height}
                    />
                  </View>
                </View>

                <CustomInput
                  placeholder="โรคประจำตัว (ไม่บังคับ)"
                  value={registerCongenitalDisease}
                  onChangeText={setRegisterCongenitalDisease}
                  icon="medkit-outline"
                />

                <CustomInput
                  placeholder="รหัสผ่าน"
                  value={registerPassword}
                  onChangeText={bindInput("password", setRegisterPassword)}
                  icon="lock-closed-outline"
                  secureTextEntry
                  error={errors.password}
                />

                <CustomInput
                  placeholder="ยืนยันรหัสผ่าน"
                  value={confirmPassword}
                  onChangeText={bindInput("confirmPassword", setConfirmPassword)}
                  icon="lock-closed-outline"
                  secureTextEntry
                  error={errors.confirmPassword}
                />

                <View className="mt-2">
                  <CustomButton
                    title="ลงทะเบียน"
                    onPress={handleRegister}
                    loading={isLoading}
                    size="large"
                    variant="secondary"
                  />
                </View>

                <Text
                  className={
                    isDark
                      ? `text-center mt-5 ${captionClassName} text-slate-300 leading-[18px]`
                      : `text-center mt-5 ${captionClassName} text-[#64748B] leading-[18px]`
                  }
                >
                  การลงทะเบียนหมายความว่าคุณยอมรับ{" "}
                  <Text
                    className={
                      captionClassName + " text-[#3498DB] font-semibold"
                    }
                  >
                    เงื่อนไขการใช้งาน
                  </Text>{" "}
                  และ{" "}
                  <Text
                    className={
                      captionClassName + " text-[#3498DB] font-semibold"
                    }
                  >
                    นโยบายความเป็นส่วนตัว
                  </Text>
                </Text>
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
