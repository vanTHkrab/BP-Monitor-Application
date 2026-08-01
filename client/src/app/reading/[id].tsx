/**
 * One reading in full.
 * Ported from `client-old/components/reading-detail-modal.tsx`.
 *
 * A route rather than the `<Modal>` it was — same call as the comment thread
 * and the alerts list: it scrolls, it has actions, and Android's Back gesture
 * belongs to it.
 *
 * The layout is the original's: the big pair in a tinted panel, a two-card
 * row for status and sync state, an info table, the monitor photo, and notes.
 * The delete action is new here — client-old's modal had no way to remove a
 * reading, so a mistyped measurement stayed in the patient's history forever.
 *
 * The route param is the reading's `key`, not its server id. A queued reading
 * has no server id yet and is exactly the one someone is most likely to open
 * (they just saved it) — keying on `remoteId` would make it unopenable.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import { useActivePatient } from '@/modules/caregivers';
import {
  statusColorFor,
  statusLabel,
  useDeleteReading,
  useReadings,
  type Reading,
} from '@/modules/readings';
import { SecurityHeader } from '@/modules/security';

export default function ReadingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const readingKey = decodeURIComponent(id ?? '');

  const colors = useTheme();
  const fontScale = useFontScale();
  const { userId } = useSession();
  const { viewingPatientId } = useActivePatient();

  const { readings, isLoading } = useReadings({ patientId: viewingPatientId });
  const { deleteReading, isDeleting, error } = useDeleteReading();

  const reading = readings.find((item) => item.key === readingKey);

  const confirmDelete = (target: Reading) => {
    Alert.alert(
      'ลบค่าความดันนี้',
      'ลบถาวร กู้คืนไม่ได้ ต้องการดำเนินการต่อหรือไม่',
      [
        { text: 'ไม่ใช่ตอนนี้', style: 'cancel' },
        {
          text: 'ลบถาวร',
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteReading(target);
            // Only leave on success — staying put is what lets the inline
            // error below be read at all.
            if (ok) router.back();
          },
        },
      ],
    );
  };

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="รายละเอียดการวัด" />

        {reading ? (
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}
          >
            <View
              className="mb-4 rounded-[28px] border p-5"
              style={{
                backgroundColor: colors['surface-muted'],
                borderColor: colors.border,
              }}
            >
              <View className="flex-row items-end justify-center">
                <Text
                  testID="reading-detail-systolic"
                  className="font-bold"
                  style={{
                    fontSize: Math.round(44 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  {reading.systolic}
                </Text>
                <Text
                  className="mx-1 font-bold"
                  style={{
                    fontSize: Math.round(36 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  /
                </Text>
                <Text
                  className="font-bold"
                  style={{
                    fontSize: Math.round(44 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  {reading.diastolic}
                </Text>
                <Text
                  className="mb-2 ml-2"
                  style={{
                    fontSize: Math.round(15 * fontScale),
                    color: colors['text-secondary'],
                  }}
                >
                  mmHg
                </Text>
              </View>

              <View className="mt-2 flex-row items-center justify-center">
                <Ionicons name="heart" size={18} color="#E91E63" />
                <Text
                  className="ml-2 font-semibold"
                  style={{
                    fontSize: Math.round(15 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  {`ชีพจร ${reading.pulse} bpm`}
                </Text>
              </View>
            </View>

            <View className="mb-4 flex-row">
              <View
                className="mr-2 flex-1 rounded-2xl border p-3"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <Text
                  style={{
                    fontSize: Math.round(13 * fontScale),
                    color: colors['text-secondary'],
                  }}
                >
                  สถานะ
                </Text>
                <View className="mt-2 flex-row items-center">
                  <View
                    className="mr-2 h-3 w-3 rounded-full"
                    style={{ backgroundColor: statusColorFor(reading.status) }}
                  />
                  <Text
                    testID="reading-detail-status"
                    className="font-bold"
                    style={{
                      fontSize: Math.round(15 * fontScale),
                      color: colors['text-primary'],
                    }}
                  >
                    {statusLabel(reading.status)}
                  </Text>
                </View>
              </View>

              <View
                className="ml-2 flex-1 rounded-2xl border p-3"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <Text
                  style={{
                    fontSize: Math.round(13 * fontScale),
                    color: colors['text-secondary'],
                  }}
                >
                  แหล่งข้อมูล
                </Text>
                <Text
                  testID="reading-detail-sync"
                  className="mt-2 font-bold"
                  style={{
                    fontSize: Math.round(15 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  {reading.syncState === 'queued' ? 'รอซิงก์' : 'ซิงก์แล้ว'}
                </Text>
              </View>
            </View>

            <View
              className="mb-4 rounded-2xl border p-4"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <InfoRow label="วัดเมื่อ" value={formatFullDateTime(reading.measuredAt)} />
              <InfoRow label="บันทึกเข้าแอป" value={formatFullDateTime(reading.createdAt)} />
              {reading.recordedById ? (
                <InfoRow
                  label="บันทึกโดย"
                  value={
                    reading.recordedById === userId
                      ? 'คุณบันทึกให้'
                      : (reading.recordedByName ?? 'ผู้ดูแล')
                  }
                />
              ) : null}
              <InfoRow
                label="รหัสรายการ"
                value={reading.clientId ?? String(reading.remoteId ?? '-')}
                isLast
              />
            </View>

            <View
              className="mb-4 rounded-2xl border p-4"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <Text
                className="mb-3 font-bold"
                style={{ fontSize: Math.round(15 * fontScale), color: colors['text-primary'] }}
              >
                รูปเครื่องวัดความดัน
              </Text>

              {reading.imageUri ? (
                <Image
                  source={{ uri: reading.imageUri }}
                  style={{ width: '100%', height: 224, borderRadius: 16 }}
                  contentFit="cover"
                  accessibilityLabel="รูปหน้าจอเครื่องวัดความดัน"
                />
              ) : (
                <View
                  className="h-44 items-center justify-center rounded-2xl px-4"
                  style={{ backgroundColor: colors['surface-muted'] }}
                >
                  <Ionicons
                    name={reading.s3Key ? 'image-outline' : 'camera-outline'}
                    size={34}
                    color={colors['text-secondary']}
                  />
                  <Text
                    className="mt-2 text-center"
                    style={{
                      fontSize: Math.round(13 * fontScale),
                      lineHeight: Math.round(20 * fontScale),
                      color: colors['text-secondary'],
                    }}
                  >
                    {/* An `s3Key` with no local file means the photo is on the
                        server but this device has never downloaded it. Signed
                        -URL resolution is not ported yet — see
                        docs/todo/CLIENT-camera-models.md. */}
                    {reading.s3Key
                      ? 'รูปอยู่บนเซิร์ฟเวอร์ แต่ยังโหลดมาแสดงในเครื่องนี้ไม่ได้'
                      : 'รายการนี้ยังไม่มีรูปเครื่องวัดความดัน'}
                  </Text>
                </View>
              )}
            </View>

            <View
              className="mb-4 rounded-2xl border p-4"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <Text
                className="font-bold"
                style={{ fontSize: Math.round(15 * fontScale), color: colors['text-primary'] }}
              >
                หมายเหตุ
              </Text>
              <Text
                className="mt-2"
                style={{
                  fontSize: Math.round(15 * fontScale),
                  lineHeight: Math.round(24 * fontScale),
                  color: colors['text-secondary'],
                }}
              >
                {reading.notes?.trim() || 'ไม่มีหมายเหตุเพิ่มเติม'}
              </Text>
            </View>

            {error ? (
              <Text
                className="mb-3 px-1"
                accessibilityLiveRegion="polite"
                style={{ fontSize: Math.round(14 * fontScale), color: colors.danger }}
              >
                {error}
              </Text>
            ) : null}

            <Pressable
              testID="reading-detail-delete"
              onPress={() => confirmDelete(reading)}
              disabled={isDeleting}
              accessibilityRole="button"
              accessibilityLabel="ลบค่าความดันนี้"
              accessibilityState={{ disabled: isDeleting, busy: isDeleting }}
              className="items-center justify-center rounded-2xl"
              style={({ pressed }) => ({
                minHeight: 52,
                backgroundColor: colors['surface-muted'],
                opacity: isDeleting ? 0.5 : pressed ? 0.85 : 1,
              })}
            >
              <Text
                className="font-bold"
                style={{ fontSize: Math.round(15 * fontScale), color: colors.danger }}
              >
                ลบรายการนี้
              </Text>
            </Pressable>
          </ScrollView>
        ) : (
          <View className="px-5">
            <View
              testID="reading-detail-missing"
              className="rounded-2xl border p-5"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <Text
                style={{
                  fontSize: Math.round(15 * fontScale),
                  lineHeight: Math.round(22 * fontScale),
                  color: colors['text-secondary'],
                }}
              >
                {isLoading ? 'กำลังโหลด...' : 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว'}
              </Text>
            </View>
          </View>
        )}
      </View>
    </GradientBackground>
  );
}

function InfoRow({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <View className={isLast ? 'flex-row items-center' : 'mb-3 flex-row items-center'}>
      <Text
        className="flex-1"
        style={{ fontSize: Math.round(15 * fontScale), color: colors['text-secondary'] }}
      >
        {label}
      </Text>
      <Text
        className="flex-1 text-right font-semibold"
        numberOfLines={1}
        style={{ fontSize: Math.round(15 * fontScale), color: colors['text-primary'] }}
      >
        {value}
      </Text>
    </View>
  );
}

function formatFullDateTime(date: Date): string {
  const day = date.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time} น.`;
}
