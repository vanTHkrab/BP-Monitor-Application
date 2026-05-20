import { CustomButton } from "@/components/custom-button";
import { CustomInput } from "@/components/custom-input";
import { GradientBackground } from "@/components/gradient-background";
import { useAppStore } from "@/src/store/use-app-store";
import { Colors } from "@/src/themes/colors";
import { CaregiverLink } from "@/src/types";
import { getFontClass } from "@/src/utils/font-scale";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";

export default function CaregiversScreen() {
  const {
    user,
    caregiverLinks,
    fetchCaregiverLinks,
    addCaregiverPatient,
    removeCaregiverPatient,
    clearAuthError,
  } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === "dark";
  const headerIconColor = isDark ? "#E2E8F0" : Colors.text.primary;
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

  const [patientPhone, setPatientPhone] = useState("");
  const [relationship, setRelationship] = useState("family");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void fetchCaregiverLinks();
  }, [fetchCaregiverLinks]);

  const myPatients = useMemo(
    () => caregiverLinks.filter((link) => link.caregiverId === user?.id),
    [caregiverLinks, user?.id],
  );
  const myCaregivers = useMemo(
    () => caregiverLinks.filter((link) => link.patientId === user?.id),
    [caregiverLinks, user?.id],
  );

  const handleAdd = async () => {
    if (!patientPhone.trim()) {
      Alert.alert("ข้อมูลไม่ครบ", "กรุณากรอกเบอร์โทรศัพท์ผู้ป่วย");
      return;
    }

    setIsSaving(true);
    clearAuthError();
    try {
      const ok = await addCaregiverPatient({
        patientPhone,
        relationship,
      });
      if (!ok) {
        const { authErrorMessage } = useAppStore.getState();
        Alert.alert("เพิ่มไม่สำเร็จ", authErrorMessage || "กรุณาลองใหม่");
        return;
      }
      setPatientPhone("");
      setRelationship("family");
      Alert.alert("สำเร็จ", "เชื่อมผู้ป่วยเรียบร้อยแล้ว");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmRemove = (link: CaregiverLink) => {
    Alert.alert(
      "ลบความสัมพันธ์",
      `ต้องการลบการเชื่อมกับ ${link.patientName || link.caregiverName} ใช่ไหม?`,
      [
        { text: "ยกเลิก", style: "cancel" },
        {
          text: "ลบ",
          style: "destructive",
          onPress: async () => {
            const ok = await removeCaregiverPatient({
              caregiverId: link.caregiverId,
              patientId: link.patientId,
            });
            if (!ok) Alert.alert("ไม่สำเร็จ", "ไม่สามารถลบความสัมพันธ์ได้");
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
            ผู้ดูแลและผู้ป่วย
          </Text>
          <View className="w-7" />
        </View>

        <View className="px-4">
          <View className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-sky-200 dark:border-slate-700 mb-5">
            <View className="flex-row items-start mb-3">
              <View className="w-11 h-11 rounded-2xl bg-sky-100 dark:bg-slate-800 items-center justify-center mr-3">
                <Ionicons name="people-outline" size={24} color={Colors.primary.blue} />
              </View>
              <View className="flex-1">
                <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                  เพิ่มผู้ป่วยในการดูแล
                </Text>
                <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1 leading-5"}>
                  กรอกเบอร์โทรศัพท์ของบัญชีผู้ป่วยที่สมัครไว้ เพื่อเชื่อมเข้าตาราง caregiver_patient
                </Text>
              </View>
            </View>

            <CustomInput
              placeholder="เบอร์โทรศัพท์ผู้ป่วย"
              value={patientPhone}
              onChangeText={setPatientPhone}
              icon="call-outline"
              keyboardType="phone-pad"
            />
            <CustomInput
              placeholder="ความสัมพันธ์ เช่น family, nurse"
              value={relationship}
              onChangeText={setRelationship}
              icon="heart-outline"
            />
            <CustomButton title="เพิ่มผู้ป่วย" onPress={handleAdd} loading={isSaving} />
          </View>

          <LinkSection
            title="ผู้ป่วยที่ฉันดูแล"
            emptyText="ยังไม่ได้เพิ่มผู้ป่วย"
            links={myPatients}
            currentUserId={user?.id}
            onRemove={confirmRemove}
            mode="patient"
            bodyClassName={bodyClassName}
            captionClassName={captionClassName}
            isDark={isDark}
          />

          <LinkSection
            title="ผู้ดูแลของฉัน"
            emptyText="ยังไม่มีผู้ดูแลเชื่อมกับบัญชีนี้"
            links={myCaregivers}
            currentUserId={user?.id}
            onRemove={confirmRemove}
            mode="caregiver"
            bodyClassName={bodyClassName}
            captionClassName={captionClassName}
            isDark={isDark}
          />
        </View>

        <View className="h-8" />
      </ScrollView>
    </GradientBackground>
  );
}

function LinkSection({
  title,
  emptyText,
  links,
  onRemove,
  mode,
  bodyClassName,
  captionClassName,
  isDark,
}: {
  title: string;
  emptyText: string;
  links: CaregiverLink[];
  currentUserId?: string;
  onRemove: (link: CaregiverLink) => void;
  mode: "patient" | "caregiver";
  bodyClassName: string;
  captionClassName: string;
  isDark: boolean;
}) {
  return (
    <View className="mb-5">
      <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3"}>
        {title}
      </Text>
      {links.length > 0 ? (
        links.map((link) => {
          const name = mode === "patient" ? link.patientName : link.caregiverName;
          const phone = mode === "patient" ? link.patientPhone : link.caregiverPhone;
          return (
            <View
              key={`${link.caregiverId}-${link.patientId}`}
              className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-sky-200 dark:border-slate-700 mb-3"
            >
              <View className="flex-row items-start">
                <View className="w-10 h-10 rounded-full bg-sky-100 dark:bg-slate-800 items-center justify-center mr-3">
                  <Ionicons name="person" size={20} color={Colors.primary.blue} />
                </View>
                <View className="flex-1">
                  <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                    {name || "ผู้ใช้"}
                  </Text>
                  <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1"}>
                    {phone} • {link.relationship}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => onRemove(link)}
                  className={(isDark ? "bg-[#111827]" : "bg-red-50") + " w-9 h-9 rounded-xl items-center justify-center"}
                >
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      ) : (
        <View className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-sky-200 dark:border-slate-700">
          <Text className={captionClassName + " text-gray-500 dark:text-slate-300"}>
            {emptyText}
          </Text>
        </View>
      )}
    </View>
  );
}
