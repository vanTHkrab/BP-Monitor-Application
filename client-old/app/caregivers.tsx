import { CustomButton } from "@/components/custom-button";
import { CustomInput } from "@/components/custom-input";
import { GradientBackground } from "@/components/gradient-background";
import { Colors } from "@/constants/colors";
import { useFocusFetch } from "@/hooks/use-focus-fetch";
import { useAppStore } from "@/store/use-app-store";
import { CaregiverLink, PatientSummary } from "@/types";
import { fontPresetClass } from "@/utils/font-scale";
import { Ionicons } from "@expo/vector-icons";
import { Href, router } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";

export default function CaregiversScreen() {
  const {
    user,
    caregiverLinks,
    myPatients,
    pendingInvites,
    fetchCaregiverLinks,
    fetchMyPatients,
    fetchPendingInvites,
    addCaregiverPatient,
    removeCaregiverPatient,
    respondToInvite,
    setActivePatientId,
    clearAuthError,
  } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === "dark";
  const headerIconColor = isDark ? "#E2E8F0" : Colors.text.primary;
  const isCaregiver = user?.role === 'caregiver';
  const titleClassName = fontPresetClass.title(fontSizePreference);
  const bodyClassName = fontPresetClass.body(fontSizePreference);
  const captionClassName = fontPresetClass.caption(fontSizePreference);

  const [patientPhone, setPatientPhone] = useState("");
  const [relationship, setRelationship] = useState("family");
  const [isSaving, setIsSaving] = useState(false);

  // Refetch on every focus (not just mount) so returning from a screen
  // pushed on top — or re-opening this one — reflects invite/link changes
  // made elsewhere without a manual refresh.
  useFocusFetch(
    useCallback(() => {
      void fetchCaregiverLinks();
      if (isCaregiver) void fetchMyPatients();
      else void fetchPendingInvites();
    }, [fetchCaregiverLinks, fetchMyPatients, fetchPendingInvites, isCaregiver]),
  );

  // Caregiver-side: คำเชิญที่ส่งไปแล้วยังรอตอบ
  const sentPending = useMemo(
    () =>
      caregiverLinks.filter(
        (link) => link.caregiverId === user?.id && link.status === 'pending',
      ),
    [caregiverLinks, user?.id],
  );

  // Patient-side: ผู้ดูแลที่ accepted
  const myCaregivers = useMemo(
    () =>
      caregiverLinks.filter(
        (link) => link.patientId === user?.id && link.status === 'accepted',
      ),
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
      const ok = await addCaregiverPatient({ patientPhone, relationship });
      if (!ok) {
        const { authErrorMessage } = useAppStore.getState();
        Alert.alert("ส่งคำเชิญไม่สำเร็จ", authErrorMessage || "กรุณาลองใหม่");
        return;
      }
      setPatientPhone("");
      setRelationship("family");
      Alert.alert(
        "ส่งคำเชิญแล้ว",
        "รอผู้ป่วยตอบรับคำเชิญในแอป จึงจะเห็นข้อมูลของท่านได้",
      );
      void fetchCaregiverLinks();
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
            else void fetchMyPatients();
          },
        },
      ],
    );
  };

  const respond = async (link: CaregiverLink, accept: boolean) => {
    const ok = await respondToInvite({ caregiverId: link.caregiverId, accept });
    if (!ok) Alert.alert("ไม่สำเร็จ", "กรุณาลองใหม่");
  };

  const viewPatientData = async (patient: PatientSummary) => {
    await setActivePatientId(patient.id);
    router.replace('/(tabs)' as Href);
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
          {/* คำเชิญที่ผู้ป่วยรอตอบ — แสดงด้านบนสุด */}
          {!isCaregiver && pendingInvites.length > 0 && (
            <View className="mb-5">
              <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3"}>
                คำเชิญที่รอตอบรับ ({pendingInvites.length})
              </Text>
              {pendingInvites.map((link) => (
                <View
                  key={`${link.caregiverId}-${link.patientId}`}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-amber-300 dark:border-amber-700 mb-3"
                >
                  <View className="flex-row items-start mb-3">
                    <View className="w-11 h-11 rounded-full bg-amber-100 dark:bg-amber-900/30 items-center justify-center mr-3">
                      <Ionicons name="mail-outline" size={22} color="#D97706" />
                    </View>
                    <View className="flex-1">
                      <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                        คุณ {link.caregiverName}
                      </Text>
                      <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1"}>
                        {link.caregiverPhone} • ขอเป็น {link.relationship}
                      </Text>
                      <Text className={captionClassName + " text-amber-700 dark:text-amber-400 mt-2 leading-5"}>
                        ผู้ดูแลรายนี้ขอดูข้อมูลความดันโลหิตของคุณ
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row" style={{ gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => respond(link, false)}
                      className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-xl py-3 items-center"
                    >
                      <Text className={bodyClassName + ' font-semibold text-gray-700 dark:text-slate-200'}>
                        ปฏิเสธ
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => respond(link, true)}
                      className="flex-1 bg-[#27AE60] rounded-xl py-3 items-center"
                    >
                      <Text className={bodyClassName + ' font-bold text-white'}>
                        อนุญาต
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Caregiver — เพิ่มผู้ป่วย */}
          {isCaregiver && (
            <View className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-sky-200 dark:border-slate-700 mb-5">
              <View className="flex-row items-start mb-3">
                <View className="w-11 h-11 rounded-2xl bg-sky-100 dark:bg-slate-800 items-center justify-center mr-3">
                  <Ionicons name="people-outline" size={24} color={Colors.primary.blue} />
                </View>
                <View className="flex-1">
                  <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                    เชิญผู้ป่วยในการดูแล
                  </Text>
                  <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1 leading-5"}>
                    กรอกเบอร์ของผู้ป่วย — ระบบจะส่งคำเชิญและรอผู้ป่วยตอบรับก่อน
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
              <CustomButton title="ส่งคำเชิญ" onPress={handleAdd} loading={isSaving} />
            </View>
          )}

          {/* Caregiver — ผู้ป่วยที่ดูแลอยู่ (accepted) */}
          {isCaregiver && (
            <View className="mb-5">
              <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3"}>
                ผู้ป่วยที่ฉันดูแล ({myPatients.length})
              </Text>
              {myPatients.length > 0 ? (
                myPatients.map((patient) => (
                  <View
                    key={patient.id}
                    className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-sky-200 dark:border-slate-700 mb-3"
                  >
                    <View className="flex-row items-center mb-3">
                      <View className="w-12 h-12 rounded-full bg-sky-100 dark:bg-slate-800 items-center justify-center mr-3">
                        <Ionicons name="person" size={24} color={Colors.primary.blue} />
                      </View>
                      <View className="flex-1">
                        <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                          คุณ {patient.firstname} {patient.lastname}
                        </Text>
                        <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-0.5"}>
                          {patient.phone} • {patient.relationship ?? 'ผู้ป่วย'}
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row" style={{ gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => {
                          confirmRemove({
                            caregiverId: user!.id,
                            patientId: patient.id,
                            relationship: patient.relationship ?? '',
                            caregiverName: '',
                            caregiverPhone: '',
                            patientName: `${patient.firstname} ${patient.lastname}`,
                            patientPhone: patient.phone,
                            status: 'accepted',
                          });
                        }}
                        className={(isDark ? 'bg-[#111827]' : 'bg-red-50') + ' px-4 rounded-xl items-center justify-center'}
                      >
                        <Ionicons name="trash-outline" size={18} color="#EF4444" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => void viewPatientData(patient)}
                        className="flex-1 bg-[#7E57C2] rounded-xl py-3 flex-row items-center justify-center"
                      >
                        <Ionicons name="eye-outline" size={18} color="white" />
                        <Text className={bodyClassName + ' font-bold text-white ml-2'}>
                          ดูข้อมูล
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              ) : (
                <View className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-sky-200 dark:border-slate-700">
                  <Text className={captionClassName + " text-gray-500 dark:text-slate-300"}>
                    ยังไม่มีผู้ป่วยที่ตอบรับคำเชิญ
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Caregiver — คำเชิญที่ส่งแล้ว pending */}
          {isCaregiver && sentPending.length > 0 && (
            <View className="mb-5">
              <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3"}>
                คำเชิญที่ส่งแล้ว ({sentPending.length})
              </Text>
              {sentPending.map((link) => (
                <View
                  key={`${link.caregiverId}-${link.patientId}`}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-gray-200 dark:border-slate-700 mb-3 flex-row items-center"
                >
                  <View className="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 items-center justify-center mr-3">
                    <Ionicons name="time-outline" size={20} color="#9CA3AF" />
                  </View>
                  <View className="flex-1">
                    <Text className={bodyClassName + " font-semibold text-gray-700 dark:text-slate-200"}>
                      {link.patientName || link.patientPhone}
                    </Text>
                    <Text className={captionClassName + " text-gray-500 dark:text-slate-400 mt-0.5"}>
                      รอผู้ป่วยตอบรับ
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => confirmRemove(link)}
                    className={(isDark ? 'bg-[#111827]' : 'bg-red-50') + ' w-9 h-9 rounded-xl items-center justify-center'}
                  >
                    <Ionicons name="close" size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Patient — ผู้ดูแลของฉัน (accepted) */}
          {!isCaregiver && (
            <View className="mb-5">
              <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3"}>
                ผู้ดูแลของฉัน ({myCaregivers.length})
              </Text>
              {myCaregivers.length > 0 ? (
                myCaregivers.map((link) => (
                  <View
                    key={`${link.caregiverId}-${link.patientId}`}
                    className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-sky-200 dark:border-slate-700 mb-3 flex-row items-center"
                  >
                    <View className="w-10 h-10 rounded-full bg-sky-100 dark:bg-slate-800 items-center justify-center mr-3">
                      <Ionicons name="person" size={20} color={Colors.primary.blue} />
                    </View>
                    <View className="flex-1">
                      <Text className={bodyClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                        คุณ {link.caregiverName || 'ผู้ดูแล'}
                      </Text>
                      <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1"}>
                        {link.caregiverPhone} • {link.relationship}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => confirmRemove(link)}
                      className={(isDark ? 'bg-[#111827]' : 'bg-red-50') + ' w-9 h-9 rounded-xl items-center justify-center'}
                    >
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))
              ) : (
                <View className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-sky-200 dark:border-slate-700">
                  <Text className={captionClassName + " text-gray-500 dark:text-slate-300"}>
                    ยังไม่มีผู้ดูแลที่เชื่อมกับบัญชีนี้
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        <View className="h-8" />
      </ScrollView>
    </GradientBackground>
  );
}
