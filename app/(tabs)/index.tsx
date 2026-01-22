import { AnimatedPressable, FadeInView, PulseView, ScaleOnMount } from '@/components/animated-components';
import { GradientBackground } from '@/components/gradient-background';
import { Colors, getStatusColor, getStatusText } from '@/constants/colors';
import { formatThaiDate } from '@/data/mockData';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  const { user, readings } = useAppStore();
  const latestReading = readings[0];

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeInView delay={100}>
          <View style={styles.header}>
            <View style={styles.userInfo}>
              <View style={styles.avatarContainer}>
                {user?.avatar ? (
                  <Image source={{ uri: user.avatar }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Ionicons name="person" size={24} color={Colors.text.secondary} />
                  </View>
                )}
              </View>
              <Text style={styles.greeting}>สวัสดี, คุณ {user?.name || 'ผู้ใช้'}</Text>
            </View>
            <AnimatedPressable onPress={() => {}} style={styles.notificationBtn}>
              <Ionicons name="notifications-outline" size={26} color={Colors.text.primary} />
            </AnimatedPressable>
          </View>
        </FadeInView>

        {/* Latest Reading Card */}
        <ScaleOnMount delay={200}>
          <View style={styles.mainCard}>
            <LinearGradient
              colors={['#FFFFFF', '#F8FAFC']}
              style={styles.mainCardGradient}
            >
              <Text style={styles.lastReadingLabel}>
                ผลการวัดล่าสุด {latestReading ? formatThaiDate(latestReading.measuredAt) : '-'}
              </Text>
              
              {latestReading ? (
                <>
                  <PulseView active={true}>
                    <View style={styles.bpValueContainer}>
                      <Text style={styles.bpValueMain}>{latestReading.systolic}</Text>
                      <Text style={styles.bpValueSlash}>/</Text>
                      <Text style={styles.bpValueMain}>{latestReading.diastolic}</Text>
                      <Text style={styles.bpUnit}>mmHg</Text>
                    </View>
                  </PulseView>
                  
                  <View style={styles.statusRow}>
                    <View style={styles.pulseContainer}>
                      <Ionicons name="heart" size={20} color={Colors.heartRate.icon} />
                      <Text style={styles.pulseText}>{latestReading.pulse} bpm</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(latestReading.status) + '20' }]}>
                      <View style={[styles.statusDot, { backgroundColor: getStatusColor(latestReading.status) }]} />
                      <Text style={[styles.statusText, { color: getStatusColor(latestReading.status) }]}>
                        สถานะ: {getStatusText(latestReading.status)}
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <Text style={styles.noDataText}>ยังไม่มีข้อมูล</Text>
              )}
            </LinearGradient>
          </View>
        </ScaleOnMount>

        {/* Camera Button */}
        <FadeInView delay={300}>
          <AnimatedPressable 
            onPress={() => router.push('/(tabs)/camera' as Href)}
            style={styles.cameraButtonWrapper}
          >
            <LinearGradient
              colors={['#5DADE2', '#3498DB', '#2980B9']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.cameraButton}
            >
              <View style={styles.cameraIconContainer}>
                <Ionicons name="camera" size={26} color="#3498DB" />
              </View>
              <Text style={styles.cameraButtonText}>คลิกที่นี่ เพื่อ ถ่ายภาพวัดความดัน</Text>
            </LinearGradient>
          </AnimatedPressable>
        </FadeInView>

        {/* Trends and Reports Section */}
        <FadeInView delay={400}>
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>แนวโน้มและรายงาน</Text>
            
            <View style={styles.cardRow}>
              {/* View History */}
              <AnimatedPressable
                onPress={() => router.push('/(tabs)/history' as Href)}
                style={styles.cardHalf}
              >
                <View style={styles.historyCard}>
                  <View style={styles.historyIconContainer}>
                    <Ionicons name="trending-up" size={32} color="#5DADE2" />
                  </View>
                  <Text style={styles.cardSubText}>ดูประวัติทั้งหมด</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.text.secondary} />
                </View>
              </AnimatedPressable>
              
              {/* Generate Report */}
              <AnimatedPressable
                onPress={() => {}}
                style={styles.cardHalf}
              >
                <View style={styles.reportCard}>
                  <Text style={styles.reportLabel}>สร้างรายงานสุขภาพ</Text>
                  <LinearGradient
                    colors={['#2C3E50', '#1a1a2e']}
                    style={styles.pdfIcon}
                  >
                    <Text style={styles.pdfText}>PDF</Text>
                  </LinearGradient>
                  <Text style={styles.cardSubText}>กดเพื่อสร้าง</Text>
                </View>
              </AnimatedPressable>
            </View>
          </View>
        </FadeInView>

        {/* Health Tips Section */}
        <FadeInView delay={500}>
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>สุขภาพและการดูแลตัวเอง</Text>
            
            <AnimatedPressable onPress={() => {}} style={{ marginBottom: 12 }}>
              <View style={styles.healthTipCard}>
                <View style={styles.healthTipIconContainer}>
                  <Ionicons name="leaf" size={22} color="#27AE60" />
                </View>
                <View style={styles.healthTipContent}>
                  <Text style={styles.healthTipTitle}>เคล็ดลับการดูแลสุขภาพ</Text>
                  <Text style={styles.healthTipDesc}>อ่านบทความเกี่ยวกับการดูแลความดันโลหิต</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={Colors.text.secondary} />
              </View>
            </AnimatedPressable>
            
            <AnimatedPressable onPress={() => {}}>
              <LinearGradient
                colors={['#9B59B6', '#8E44AD', '#6C3483']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.reminderCard}
              >
                <View style={styles.reminderIconContainer}>
                  <Ionicons name="calendar" size={22} color="white" />
                </View>
                <View style={styles.healthTipContent}>
                  <Text style={styles.reminderTitle}>ตั้งการแจ้งเตือน</Text>
                  <Text style={styles.reminderDesc}>เตือนให้วัดความดันเป็นประจำ</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="white" />
              </LinearGradient>
            </AnimatedPressable>
          </View>
        </FadeInView>

        <View style={{ height: 100 }} />
      </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'white',
    overflow: 'hidden',
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F0F0',
  },
  greeting: {
    fontSize: 18,
    color: '#2C3E50',
    fontWeight: '600',
  },
  notificationBtn: {
    padding: 8,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  mainCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  mainCardGradient: {
    padding: 20,
    borderRadius: 24,
  },
  lastReadingLabel: {
    color: '#7F8C8D',
    textAlign: 'center',
    marginBottom: 12,
    fontSize: 14,
    fontWeight: '500',
  },
  bpValueContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  bpValueMain: {
    fontSize: 52,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  bpValueSlash: {
    fontSize: 52,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginHorizontal: 4,
  },
  bpUnit: {
    fontSize: 18,
    color: '#7F8C8D',
    marginLeft: 8,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  pulseContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDE8E8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pulseText: {
    color: '#E91E63',
    marginLeft: 6,
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontWeight: '600',
    fontSize: 14,
  },
  noDataText: {
    textAlign: 'center',
    color: '#7F8C8D',
    fontSize: 16,
  },
  cameraButtonWrapper: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  cameraButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: '#3498DB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  cameraIconContainer: {
    width: 44,
    height: 44,
    backgroundColor: 'white',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cameraButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  sectionContainer: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2C3E50',
    marginBottom: 16,
  },
  cardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cardHalf: {
    flex: 1,
  },
  historyCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  historyIconContainer: {
    width: 64,
    height: 64,
    backgroundColor: '#EBF5FB',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  reportCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  reportLabel: {
    fontSize: 11,
    color: '#7F8C8D',
    marginBottom: 4,
  },
  pdfIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  pdfText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cardSubText: {
    color: '#7F8C8D',
    fontSize: 13,
    marginBottom: 4,
  },
  healthTipCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  healthTipIconContainer: {
    width: 44,
    height: 44,
    backgroundColor: '#E8F5E9',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  healthTipContent: {
    flex: 1,
  },
  healthTipTitle: {
    color: '#2C3E50',
    fontWeight: '600',
    fontSize: 15,
  },
  healthTipDesc: {
    color: '#7F8C8D',
    fontSize: 13,
    marginTop: 2,
  },
  reminderCard: {
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#8E44AD',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  reminderIconContainer: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  reminderTitle: {
    color: 'white',
    fontWeight: '600',
    fontSize: 15,
  },
  reminderDesc: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    marginTop: 2,
  },
});
