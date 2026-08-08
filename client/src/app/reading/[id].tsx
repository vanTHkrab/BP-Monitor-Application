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
 *
 * **The photo comes from `useResolvedImageUri`, not from a raw field.** A
 * reading taken here has a local `imageUri`; one fetched from the server has
 * only `s3Key`, which despite the name is a short-lived *signed URL* the
 * gateway re-signs on every request. Rendering that directly goes blank when
 * the signature expires and shows nothing at all offline, so it goes through
 * the 7-day file cache in `modules/readings/lib/image-cache.ts`.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import {
  statusColorFor,
  statusLabel,
  useDeleteReading,
  useReadings,
  useResolvedImageUri,
  type Reading,
} from '@/modules/readings';
import { SecurityHeader } from '@/modules/security';

export default function ReadingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const readingKey = decodeURIComponent(id ?? '');

  const colors = useTheme();
  const { userId } = useSession();

  const { readings, isLoading } = useReadings();
  const { deleteReading, isDeleting, error } = useDeleteReading();

  const reading = readings.find((item) => item.key === readingKey);

  /*
   * `imageUri` is the local file for a photo taken on this device; `s3Key` is
   * a short-lived *signed URL* for one stored on the server (the field name
   * predates the gateway signing it). Prefer the local file — it needs no
   * network and never expires — and fall back to resolving the signed URL
   * through the cache, which is what makes a reading taken on another device,
   * or any reading after a reinstall, show its photo at all.
   */
  const imageUri = useResolvedImageUri(reading?.imageUri ?? reading?.s3Key);

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
        <SecurityHeader title="รายละเอียดการวัด" subject="patient" />

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
                {/*
                  `family="mono"` on all three: the figure is a *number to compare*,
                  and proportional digits make a column of readings jitter — 1 is
                  narrow, 8 is wide, so 120/80 and 148/92 do not line up. Tabular
                  digits make the home hero card, a history row, and the detail
                  screen agree on the width of a reading. It also takes the figure
                  off the user's family preference, which was never a choice about
                  numerals. See `themed-text.tsx`'s `family` prop.

                  `size={38}`, not a role. This screen used to be the odd one out:
                  `type="display"` (44) for the digits and `size={36}` for the
                  slash, against 48/48 on the home hero card and 38/38 in a history
                  row. Nobody chose 44, and nobody chose 36 as its companion — see
                  `docs/project/CLIENT-typography.md` §3(b). The figure now renders
                  at two sizes app-wide, 48 on the hero and 38 everywhere else, with
                  the slash at the digits' own size on all three surfaces so the
                  `flex-row items-end` alignment is structural rather than a pair of
                  numbers somebody has to keep in step.
                */}
                <ThemedText size={38} weight="bold" family="mono" testID="reading-detail-systolic">
                  {reading.systolic}
                </ThemedText>
                <ThemedText size={38} weight="bold" family="mono" className="mx-1">
                  /
                </ThemedText>
                <ThemedText size={38} weight="bold" family="mono">
                  {reading.diastolic}
                </ThemedText>
                <ThemedText type="body" weight="regular" themeColor="text-secondary" className="mb-2 ml-2">
                  mmHg
                </ThemedText>
              </View>

              <View className="mt-2 flex-row items-center justify-center">
                <Ionicons name="heart" size={18} color="#E91E63" />
                <ThemedText type="body" weight="semibold" className="ml-2">
                  {`ชีพจร ${reading.pulse} bpm`}
                </ThemedText>
              </View>
            </View>

            <View className="mb-4 flex-row">
              <View
                className="mr-2 flex-1 rounded-2xl border p-3"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <ThemedText type="label" weight="regular" themeColor="text-secondary">
                  สถานะ
                </ThemedText>
                <View className="mt-2 flex-row items-center">
                  <View
                    className="mr-2 h-3 w-3 rounded-full"
                    style={{ backgroundColor: statusColorFor(reading.status) }}
                  />
                  <ThemedText type="body" weight="bold" testID="reading-detail-status">
                    {statusLabel(reading.status)}
                  </ThemedText>
                </View>
              </View>

              <View
                className="ml-2 flex-1 rounded-2xl border p-3"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <ThemedText type="label" weight="regular" themeColor="text-secondary">
                  แหล่งข้อมูล
                </ThemedText>
                <ThemedText type="body" weight="bold" testID="reading-detail-sync" className="mt-2">
                  {reading.syncState === 'queued' ? 'รอซิงก์' : 'ซิงก์แล้ว'}
                </ThemedText>
              </View>
            </View>

            <View
              className="mb-4 rounded-2xl border p-4"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <InfoRow label="วัดเมื่อ" value={formatFullDateTime(reading.measuredAt)} />
              <InfoRow
                label="บันทึกเข้าแอป"
                value={formatFullDateTime(reading.createdAt)}
                // Last row whenever nobody recorded this on the patient's
                // behalf — otherwise the card ends on a divider to nothing.
                isLast={!reading.recordedById}
              />
              {/*
                * No "รหัสรายการ" row. `clientId` is a uuid the queue mints for
                * de-duplication and `remoteId` is a database key — neither
                * means anything to a patient, and printing an identifier next
                * to their medical data invites them to quote it to someone.
                * If a support flow ever needs one, it belongs behind a
                * long-press-to-copy, not in the middle of the reading.
                */}
              {reading.recordedById ? (
                <InfoRow
                  label="บันทึกโดย"
                  value={
                    reading.recordedById === userId
                      ? 'คุณบันทึกให้'
                      : (reading.recordedByName ?? 'ผู้ดูแล')
                  }
                  isLast
                />
              ) : null}
            </View>

            {/* The queue records why a row failed and how often. Nothing
                rendered it, so a reading stuck behind a bad photo or an
                expired token looked identical to one waiting for a signal —
                and the only person who could reconnect the phone had no way
                to tell the difference. Shown here rather than on the card
                because it is diagnostic detail, not a list-level state. */}
            {reading.syncState === 'queued' && (reading.attempts ?? 0) > 0 ? (
              <View
                testID="reading-detail-sync-failure"
                className="mb-4 rounded-2xl border p-4"
                style={{ backgroundColor: colors.surface, borderColor: statusColorFor('high') }}
              >
                <View className="flex-row items-center">
                  <Ionicons
                    name="alert-circle-outline"
                    size={16}
                    color={statusColorFor('high')}
                  />
                  <ThemedText type="body" weight="bold" className="ml-1.5">
                    {`ส่งขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (${reading.attempts} ครั้ง)`}
                  </ThemedText>
                </View>

                <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-2">
                  ข้อมูลยังอยู่ในเครื่องและจะส่งใหม่อัตโนมัติเมื่อเชื่อมต่อได้
                  ลากหน้าจอประวัติลงเพื่อลองอีกครั้งได้ทันที
                </ThemedText>

                {reading.lastError ? (
                  <ThemedText type="caption" themeColor="text-secondary" className="mt-2">
                    {reading.lastError}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            <View
              className="mb-4 rounded-2xl border p-4"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <ThemedText type="body" weight="bold" className="mb-3">
                รูปเครื่องวัดความดัน
              </ThemedText>

              {imageUri ? (
                <Image
                  testID="reading-image"
                  source={{ uri: imageUri }}
                  style={{ width: '100%', height: 224, borderRadius: 16 }}
                  contentFit="cover"
                  accessibilityLabel="รูปหน้าจอเครื่องวัดความดัน"
                />
              ) : (
                <View
                  testID="reading-image-placeholder"
                  className="h-44 items-center justify-center rounded-2xl px-4"
                  style={{ backgroundColor: colors['surface-muted'] }}
                >
                  <Ionicons
                    name={reading.s3Key ? 'cloud-offline-outline' : 'camera-outline'}
                    size={34}
                    color={colors['text-secondary']}
                  />
                  <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-2 text-center">
                    {/* Reaching here with an `s3Key` no longer means "not
                        ported" — `useResolvedImageUri` tried and came back
                        empty, which is a failed download of a signed URL that
                        had already expired, or being offline with nothing
                        cached. Both are "try again when connected", not
                        "there is no photo". */}
                    {reading.s3Key
                      ? 'ยังโหลดรูปไม่ได้ ลองใหม่อีกครั้งเมื่อเชื่อมต่ออินเทอร์เน็ต'
                      : 'รายการนี้ยังไม่มีรูปเครื่องวัดความดัน'}
                  </ThemedText>
                </View>
              )}
            </View>

            <View
              className="mb-4 rounded-2xl border p-4"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <ThemedText type="body" weight="bold">
                หมายเหตุ
              </ThemedText>
              <ThemedText type="body" weight="regular" lineHeight={24} themeColor="text-secondary" className="mt-2">
                {reading.notes?.trim() || 'ไม่มีหมายเหตุเพิ่มเติม'}
              </ThemedText>
            </View>

            {error ? (
              <ThemedText type="body" weight="regular" themeColor="danger" accessibilityLiveRegion="polite" className="mb-3 px-1">
                {error}
              </ThemedText>
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
              <ThemedText type="body" weight="bold" themeColor="danger">
                ลบรายการนี้
              </ThemedText>
            </Pressable>
          </ScrollView>
        ) : (
          <View className="px-5">
            <View
              testID="reading-detail-missing"
              className="rounded-2xl border p-5"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <ThemedText type="body" weight="regular" themeColor="text-secondary">
                {isLoading ? 'กำลังโหลด...' : 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว'}
              </ThemedText>
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

  return (
    <View className={isLast ? 'flex-row items-center' : 'mb-3 flex-row items-center'}>
      <ThemedText type="body" weight="regular" themeColor="text-secondary" className="flex-1">
        {label}
      </ThemedText>
      <ThemedText type="body" weight="semibold" numberOfLines={1} className="flex-1 text-right">
        {value}
      </ThemedText>
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
