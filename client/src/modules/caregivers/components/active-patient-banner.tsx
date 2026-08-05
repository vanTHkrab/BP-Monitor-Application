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
 * **It does not cover the routes outside `(tabs)`** — `settings`,
 * `reading/[id]`, `history-list`, `invitations`. Those are pushed on top and
 * have their own headers. `reading/[id]` and `history-list` do read patient-
 * scoped data, so that is a real gap, listed in `docs/todo/CLIENT-caregiver.md`
 * rather than papered over here.
 *
 * Renders nothing for a patient account, and nothing for a caregiver who has
 * not entered anyone — `isViewingPatient` is false in both cases.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFontScale } from '@/hooks/use-font-scale';
import { palette } from '@/theme';

import { useActivePatient } from '../hooks/use-active-patient';

export function ActivePatientBanner() {
  const { patient, isViewingPatient, clearActivePatient } = useActivePatient();
  const fontScale = useFontScale();
  const insets = useSafeAreaInsets();

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

        <Text
          className="ml-2 flex-1 font-semibold text-white"
          numberOfLines={1}
          style={{ fontSize: Math.round(14 * fontScale) }}
        >
          {`กำลังดูข้อมูลของ ${name}`}
        </Text>

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
          <Text
            className="font-semibold text-white"
            style={{ fontSize: Math.round(13 * fontScale) }}
          >
            ออก
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
