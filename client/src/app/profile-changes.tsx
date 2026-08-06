/**
 * "ใครแก้ข้อมูลสุขภาพของฉันบ้าง" — the patient's own audit trail.
 *
 * ## Why the patient, and only the patient
 *
 * `myProfileChangeLog` takes its subject from the session and has no
 * caregiver-facing counterpart, not even one scoped to "edits I made
 * myself". Every row carries the health values on **both** sides of the
 * change, so a caregiver later downgraded to `view` — or unlinked — would
 * keep a readable window onto data they can no longer see, and filtering by
 * actor does not help because those are exactly the rows holding the data.
 *
 * That is not an incidental restriction. Reusing `full` for health edits
 * rather than adding a permission level retroactively widens what patients
 * who already granted `full` agreed to, and what makes that acceptable is
 * that revocation is complete and they can revoke at any time. This screen is
 * the other half of the same bargain: it is what makes the grant
 * *supervisable*, and therefore what makes granting it a decision rather
 * than a leap.
 *
 * ## `subject="self"`, and the entry point is hidden in caregiver mode
 *
 * The query answers about the signed-in account. A caregiver sitting inside a
 * patient would see their *own* log under a banner naming the patient — the
 * exact "two people's data on one screen" failure `use-subject.ts` exists to
 * prevent, inverted. So the header declares `self`, and
 * `app/invitations.tsx` only offers the row when `isViewingPatient` is false.
 *
 * ## Shape
 *
 * A flat list, newest first, one row per field — because "น้ำหนัก 60 → 80" is
 * what a patient will ask about, not "a profile was edited". Rows are grouped
 * under nothing: a date header would imply the log is browsed by date, and it
 * is browsed by "did anything happen that I did not expect".
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { ThemedText } from '@/components/themed-text';
import { GradientButton } from '@/components/ui/gradient-button';
import { useTheme } from '@/hooks/use-theme';
import { formatErrorMessage } from '@/lib/error-message';
import { ChangeLogEntryRow, useProfileChangeLog } from '@/modules/caregivers';
import { SecurityHeader } from '@/modules/security';

export default function ProfileChangesScreen() {
  const { entries, isLoading, isRefetching, error, refetch } = useProfileChangeLog();

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="ประวัติการแก้ไขข้อมูลสุขภาพ" subject="self" />

        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
        >
          <ThemedText
            type="small"
            weight="regular"
            themeColor="text-secondary"
            className="mb-3 mt-1 px-1"
          >
            ทุกครั้งที่คุณหรือผู้ดูแลของคุณแก้ไขวันเกิด เพศ น้ำหนัก ส่วนสูง หรือโรคประจำตัว จะบันทึกไว้ที่นี่
          </ThemedText>

          {error ? (
            <Card testID="profile-changes-error">
              <ThemedText type="default" weight="bold" className="mb-1.5">
                โหลดประวัติไม่สำเร็จ
              </ThemedText>
              <ThemedText type="small" weight="regular" themeColor="text-secondary">
                {formatErrorMessage(error, 'ดึงข้อมูลไม่สำเร็จ กรุณาลองใหม่')}
              </ThemedText>
            </Card>
          ) : isLoading ? (
            <Card testID="profile-changes-loading">
              <ThemedText type="small" weight="regular" themeColor="text-secondary">
                กำลังโหลด…
              </ThemedText>
            </Card>
          ) : entries.length === 0 ? (
            /*
              An empty log is the *good* state, and it is worded as one. "ไม่มี
              ข้อมูล" would read as a failure on a screen someone opened
              because they were worried.
            */
            <Card testID="profile-changes-empty">
              <ThemedText type="default" weight="bold" className="mb-1.5">
                ยังไม่มีการแก้ไข
              </ThemedText>
              <ThemedText type="small" weight="regular" themeColor="text-secondary">
                ยังไม่มีใครแก้ไขข้อมูลสุขภาพของคุณ รวมถึงตัวคุณเอง
              </ThemedText>
            </Card>
          ) : (
            entries.map((entry) => (
              <ChangeLogEntryRow
                key={entry.id}
                entry={entry}
                testID={`change-log-${entry.id}`}
              />
            ))
          )}

          {/*
            The action this screen leads to. Someone who finds an edit they
            did not expect wants to change what that person can do, and the
            grant is changed one screen away — leaving them to find it is
            leaving the oversight incomplete.
          */}
          {entries.some((entry) => !entry.byPatient) ? (
            <View className="mb-2 mt-3">
              <GradientButton
                testID="profile-changes-manage"
                title="จัดการสิทธิ์ผู้ดูแล"
                variant="secondary"
                onPress={() => router.push('/invitations')}
              />
            </View>
          ) : null}

          <View className="h-10" />
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useTheme();

  return (
    <View
      testID={testID}
      className="mb-3 rounded-2xl border p-5"
      style={{ backgroundColor: colors.surface, borderColor: colors['border-strong'] }}
    >
      {children}
    </View>
  );
}
