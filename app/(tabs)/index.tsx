import { useRouter } from 'expo-router';
import { ScrollView, StatusBar, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BPResultCard } from '@/components/home/bp-result-card';
import { CameraButton } from '@/components/home/camera-button';
import { HeaderSection } from '@/components/home/header-section';
import { HealthTipsSection } from '@/components/home/health-tips-section';
import { TrendsSection } from '@/components/home/trends-section';
import { AppColors } from '@/constants/colors';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Mock data - จะเปลี่ยนเป็นข้อมูลจริงจาก API/Database ภายหลัง
  const userData = {
    userName: 'intira',
    profileImage: undefined, // จะใส่ URL รูปจริงภายหลัง
  };

  const latestBPResult = {
    systolic: 112,
    diastolic: 78,
    heartRate: 75,
    status: 'ปกติ' as const,
    lastMeasuredDate: 'อ. 9 ธ.ค. 2568',
    lastMeasuredTime: '16:50',
  };

  const handleNotificationPress = () => {
    // TODO: Navigate to notifications
    console.log('Notification pressed');
  };

  const handleCameraPress = () => {
    router.push('/(tabs)/camera');
  };

  const handleViewHistory = () => {
    router.push('/history-detail');
  };

  const handleGenerateReport = () => {
    // TODO: Generate PDF report
    console.log('Generate report pressed');
  };

  const handleHealthTipPress = (tipId: string) => {
    // TODO: Navigate to health tip detail
    console.log('Health tip pressed:', tipId);
  };

  return (
    <View className="flex-1 bg-gray-100">
      <StatusBar barStyle="light-content" backgroundColor={AppColors.primary} />
      
      {/* Header Background */}
      <View className="bg-primary pb-10" style={{ paddingTop: insets.top }}>
        <HeaderSection
          userName={userData.userName}
          profileImage={userData.profileImage}
          onNotificationPress={handleNotificationPress}
        />
      </View>

      <ScrollView 
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        {/* BP Result Card */}
        <BPResultCard
          systolic={latestBPResult.systolic}
          diastolic={latestBPResult.diastolic}
          heartRate={latestBPResult.heartRate}
          status={latestBPResult.status}
          lastMeasuredDate={latestBPResult.lastMeasuredDate}
          lastMeasuredTime={latestBPResult.lastMeasuredTime}
        />

        {/* Camera Button */}
        <CameraButton onPress={handleCameraPress} />

        {/* Trends Section */}
        <TrendsSection
          onViewHistory={handleViewHistory}
          onGenerateReport={handleGenerateReport}
        />

        {/* Health Tips Section */}
        <HealthTipsSection onTipPress={handleHealthTipPress} />
      </ScrollView>
    </View>
  );
}
