import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CustomButton } from '@/components/custom-button';
import { GradientBackground } from '@/components/gradient-background';
import { MenuItem } from '@/components/menu-item';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import React from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function MenuScreen() {
  const { logout, user } = useAppStore();

  const handleLogout = () => {
    Alert.alert(
      'ออกจากระบบ',
      'คุณต้องการออกจากระบบหรือไม่?',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ออกจากระบบ',
          style: 'destructive',
          onPress: () => {
            logout();
            router.replace('/auth' as Href);
          },
        },
      ]
    );
  };

  return (
    <GradientBackground>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeInView delay={100}>
          <View style={styles.header}>
            <LinearGradient
              colors={['#5DADE2', '#3498DB']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.titleBadge}
            >
              <Ionicons name="menu" size={20} color="white" style={{ marginRight: 8 }} />
              <Text style={styles.titleText}>เมนูอื่นๆ</Text>
            </LinearGradient>
          </View>
        </FadeInView>

        {/* User Profile Card */}
        <ScaleOnMount delay={200}>
          <AnimatedPressable 
            onPress={() => router.push('/profile' as Href)}
            style={styles.profileCardWrapper}
          >
            <LinearGradient
              colors={['#FFFFFF', '#F8FAFC']}
              style={styles.profileCard}
            >
              <View style={styles.avatarContainer}>
                {user?.avatar ? (
                  <Image source={{ uri: user.avatar }} style={styles.avatar} />
                ) : (
                  <LinearGradient
                    colors={['#5DADE2', '#3498DB']}
                    style={styles.avatarPlaceholder}
                  >
                    <Ionicons name="person" size={32} color="white" />
                  </LinearGradient>
                )}
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileName}>{user?.name || 'ผู้ใช้'}</Text>
                <Text style={styles.profileEmail}>{user?.email || 'user@example.com'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#9CA3AF" />
            </LinearGradient>
          </AnimatedPressable>
        </ScaleOnMount>

        {/* Menu Items */}
        <View style={styles.menuContainer}>
          <FadeInView delay={300}>
            <Text style={styles.sectionTitle}>บัญชีและการตั้งค่า</Text>
            <MenuItem
              icon="person-outline"
              title="โปรไฟล์ของฉัน"
              onPress={() => router.push('/profile' as Href)}
            />
            
            <MenuItem
              icon="settings-outline"
              title="ตั้งค่าแอปพลิเคชั่น"
              onPress={() => router.push('/settings' as Href)}
            />
            
            <MenuItem
              icon="shield-checkmark-outline"
              title="ความปลอดภัย"
              onPress={() => router.push('/security' as Href)}
            />
          </FadeInView>

          <FadeInView delay={400}>
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>ความช่วยเหลือ</Text>
            <MenuItem
              icon="help-circle-outline"
              title="ช่วยเหลือและคำแนะนำ"
              onPress={() => router.push('/help' as Href)}
            />
            
            <MenuItem
              icon="information-circle-outline"
              title="เกี่ยวกับ"
              onPress={() => router.push('/about' as Href)}
            />
          </FadeInView>
        </View>

        {/* Logout Button */}
        <FadeInView delay={500}>
          <View style={styles.logoutContainer}>
            <CustomButton
              title="ออกจากระบบ"
              onPress={handleLogout}
              variant="danger"
            />
          </View>
        </FadeInView>

        {/* App Version */}
        <FadeInView delay={600}>
          <View style={styles.versionContainer}>
            <Text style={styles.versionText}>BP Monitor v1.0.0</Text>
          </View>
        </FadeInView>
      </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  titleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: '#3498DB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  titleText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  profileCardWrapper: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    marginRight: 14,
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
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2C3E50',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: '#7F8C8D',
  },
  menuContainer: {
    paddingHorizontal: 16,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7F8C8D',
    marginBottom: 12,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  logoutContainer: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  versionContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingBottom: 100,
  },
  versionText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
});
