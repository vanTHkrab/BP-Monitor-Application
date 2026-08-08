/**
 * "You are looking at someone else's data", above every tab.
 *
 * ## Why this is not decoration
 *
 * Once C-005 exists, a caregiver can be inside a patient's account with no
 * other signal that they are. Two things in this app write while in that
 * state: the camera records readings against `viewingPatientId`
 * (`app/(tabs)/camera.tsx`), and export attributes the document to the active
 * patient (`resolveExportSubjectName`). A caregiver who has forgotten where
 * they are can file a measurement, or hand a clinician a PDF, under the wrong
 * person's name — and nothing downstream can detect that, because both are
 * exactly what the app was told to do.
 *
 * So the banner is a **correctness control**, not a nicety, and it ships in
 * the same change as the jump rather than after it.
 *
 * ## Why it lives in the tab layout
 *
 * Mounted once in `app/(tabs)/_layout.tsx`, above the navigator. Per-screen
 * rendering was the alternative and it fails the way this whole class of bug
 * fails: the screen someone forgets is the screen where the mistake happens.
 * One mount also means a new tab inherits it for free.
 *
 * **The routes outside `(tabs)` have their own.** `settings`, `reading/[id]`,
 * `history-list`, `alerts`, and `invitations` are pushed on top of the
 * navigator with their own headers, so this never reaches them;
 * `CompactPatientBanner` covers them through `SecurityHeader`'s required
 * `subject` prop. That one is informational only — the switcher and the exit
 * live here, on the route they apply to.
 *
 * Renders nothing for a patient account, and nothing for a caregiver who has
 * not entered anyone — `isViewingPatient` is false in both cases.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { palette } from '@/theme';

import { useActivePatient } from '../hooks/use-active-patient';
import { useMyPatients } from '../hooks/use-caregivers';
import { PatientSwitcherSheet } from './patient-switcher-sheet';

export function ActivePatientBanner() {
  const { patient, isViewingPatient, clearActivePatient, setActivePatient } =
    useActivePatient();
  const insets = useSafeAreaInsets();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Already in the cache for any caregiver who reached this screen — the
  // invitations screen fetched it. Cheap here, and it is what makes the
  // switcher able to show who needs attention rather than just names.
  const { patients } = useMyPatients();

  if (!isViewingPatient) return null;

  const name = patient ? `คุณ${patient.firstname}` : 'ผู้ป่วย';

  return (
    <View
      testID="active-patient-banner"
      // Purple in both schemes rather than a semantic surface: this says "you
      // are not in your own account", which must not soften into the
      // background in either theme.
      //
      // Owns the top inset itself: it sits above the navigator, so the screens
      // underneath no longer start at the top of the window — see the inset
      // override in `app/(tabs)/_layout.tsx`.
      style={{ paddingTop: insets.top, backgroundColor: palette.purple }}
    >
      <View className="flex-row items-center px-4 pb-2.5 pt-2">
        <Ionicons name="eye-outline" size={18} color="#FFFFFF" />

        {/*
          Tapping the banner switches patient. It is the one control already
          on every screen naming the person, so it is where "and now someone
          else" belongs — the alternative was exit, menu, invitations, tap.
          Offered only when there is somebody to switch to.
        */}
        <Pressable
          testID="active-patient-banner-switch"
          onPress={() => setSwitcherOpen(true)}
          disabled={patients.length < 2}
          accessibilityRole="button"
          accessibilityLabel={
            patients.length < 2 ? `กำลังดูข้อมูลของ ${name}` : `เปลี่ยนผู้ป่วย ตอนนี้คือ ${name}`
          }
          className="ml-2 flex-1 flex-row items-center"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <ThemedText
            type="body"
            weight="semibold"
            numberOfLines={1}
            // White on the accent gradient — the background is the token, this
            // is its contrast pair, so it goes through `style` rather than
            // `themeColor`.
            style={{ color: '#FFFFFF' }}
          >
            {`กำลังดูข้อมูลของ ${name}`}
          </ThemedText>
          {patients.length > 1 ? (
            <Ionicons name="chevron-down" size={16} color="#FFFFFF" style={{ marginLeft: 4 }} />
          ) : null}
        </Pressable>

        {/*
          The only way out. `clearActivePatient` existed from the start and
          nothing called it, so a caregiver who entered a patient could not
          leave without restarting the app — the store is session-scoped, so
          a cold start was the exit.
        */}
        <Pressable
          testID="active-patient-banner-exit"
          onPress={clearActivePatient}
          accessibilityRole="button"
          accessibilityLabel={`ออกจากการดูข้อมูลของ ${name}`}
          className="ml-2 items-center justify-center rounded-full bg-white/20 px-3"
          style={({ pressed }) => ({ minHeight: 32, opacity: pressed ? 0.7 : 1 })}
        >
          <ThemedText type="label" style={{ color: '#FFFFFF' }}>
            ออก
          </ThemedText>
        </Pressable>
      </View>

      <PatientSwitcherSheet
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        patients={patients}
        activePatientId={patient?.id}
        onSelect={setActivePatient}
      />
    </View>
  );
}
