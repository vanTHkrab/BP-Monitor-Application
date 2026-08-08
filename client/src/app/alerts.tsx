/**
 * The notification list behind the home screen's bell.
 *
 * A `<Modal>` inside `client-old/app/(tabs)/index.tsx`, and a route here for
 * the same reason the comment thread and the reminder settings became routes:
 * it is a scrolling list, Android's Back gesture belongs to it, and a
 * notification is something a push payload will eventually want to deep-link
 * into.
 *
 * Each row carries the reading that triggered it. The gateway embeds that
 * snapshot specifically so this screen needs one request, not one per row —
 * see `services/alert-operations.ts`.
 */
import { Ionicons } from '@expo/vector-icons';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { useTheme } from '@/hooks/use-theme';
import {
  statusColorFor,
  statusLabel,
  useAlerts,
  useMarkAlertRead,
  useMarkAllAlertsRead,
  type Alert,
} from '@/modules/readings';
import { SecurityHeader } from '@/modules/security';

export default function AlertsScreen() {
  const colors = useTheme();

  const { alerts, unreadCount, isLoading, isRefetching, refetch, canMarkRead } = useAlerts();
  const { markAlertRead } = useMarkAlertRead();
  const { markAllAlertsRead, isPending } = useMarkAllAlertsRead();

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="การแจ้งเตือน" subject="patient" />

        {unreadCount > 0 ? (
          <View className="flex-row items-center justify-between px-5 pb-2">
            <ThemedText type="body" weight="regular" themeColor="text-secondary">
              {canMarkRead
                ? `ยังไม่ได้อ่าน ${unreadCount} รายการ`
                : `ยังไม่ได้อ่าน ${unreadCount} รายการ · ผู้ป่วยเป็นผู้อ่านเอง`}
            </ThemedText>
            {/*
              Hidden while viewing a patient. Marking read is the patient's own
              state — the gateway scopes it to the alert's owner, so the button
              would do nothing, and if it did work it would clear a critical
              alert for the person it is about. See `useAlerts().canMarkRead`.
            */}
            {canMarkRead ? (
            <Pressable
              testID="alerts-mark-all-read"
              onPress={() => markAllAlertsRead()}
              disabled={isPending}
              accessibilityRole="button"
              accessibilityLabel="ทำเครื่องหมายว่าอ่านทั้งหมดแล้ว"
              className="items-center justify-center px-2"
              style={{ minHeight: 44, opacity: isPending ? 0.5 : 1 }}
            >
              <ThemedText type="body" weight="semibold" themeColor="primary">
                อ่านทั้งหมด
              </ThemedText>
            </Pressable>
            ) : null}
          </View>
        ) : null}

        <FlatList
          data={alerts}
          keyExtractor={(alert) => String(alert.id)}
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
          ListEmptyComponent={
            <View className="mt-4 rounded-2xl p-5" style={{ backgroundColor: colors.surface }}>
              <ThemedText type="body" weight="regular" themeColor="text-secondary" testID="alerts-empty">
                {isLoading
                  ? 'กำลังโหลดการแจ้งเตือน…'
                  : 'ยังไม่มีการแจ้งเตือน ระบบจะแจ้งเมื่อพบค่าความดันที่ควรสังเกต'}
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => (
            <AlertRow
              alert={item}
              onPress={
                canMarkRead && !item.isRead ? () => markAlertRead(item.id) : undefined
              }
            />
          )}
        />
      </View>
    </GradientBackground>
  );
}

/**
 * `onPress` is optional: a caregiver viewing a patient's alerts has nothing to
 * mark — read state belongs to the patient. An undefined handler leaves the
 * row inert rather than tappable-but-silent.
 */
function AlertRow({ alert, onPress }: { alert: Alert; onPress?: () => void }) {
  const colors = useTheme();

  const accent = alert.reading ? statusColorFor(alert.reading.status) : colors['text-secondary'];

  return (
    <Pressable
      testID={`alert-${alert.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        alert.isRead ? '' : 'ยังไม่ได้อ่าน:',
        alert.isAboutSomeoneElse ? 'แจ้งเตือนเกี่ยวกับผู้ที่คุณดูแล' : '',
        alert.message,
      ]
        .filter(Boolean)
        .join(' ')}
      className="mb-3 flex-row rounded-2xl p-4"
      style={({ pressed }) => ({
        backgroundColor: colors.surface,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View
        className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: colors['surface-muted'] }}
      >
        {/*
          A caregiver's bell now mixes alerts about them with alerts about the
          people they care for. The icon is the fastest way to tell which
          without reading the sentence — the message already names the patient,
          but a list of both kinds needs to be scannable.
        */}
        <Ionicons
          name={alert.isAboutSomeoneElse ? 'people-outline' : 'pulse-outline'}
          size={20}
          color={accent}
        />
      </View>

      <View className="flex-1">
        <ThemedText type="body" weight="regular">
          {alert.message}
        </ThemedText>

        {alert.reading ? (
          <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-1">
            {`${alert.reading.systolic}/${alert.reading.diastolic} mmHg · ${statusLabel(
              alert.reading.status,
            )}`}
          </ThemedText>
        ) : null}
      </View>

      {/* An unread dot rather than a bold-plus-background treatment: the row
          is already bold, and two signals for one state is one too many. */}
      {alert.isRead ? null : (
        <View
          testID={`alert-${alert.id}-unread`}
          className="ml-2 mt-1.5 h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: colors.primary }}
        />
      )}
    </Pressable>
  );
}
