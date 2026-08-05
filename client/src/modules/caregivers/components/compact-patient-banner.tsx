/**
 * "You are looking at someone else's data", for the routes pushed on top of
 * the tab navigator.
 *
 * `ActivePatientBanner` covers the five tabs. `settings`, `reading/[id]`,
 * `history-list`, `alerts`, and `invitations` are pushed above them with
 * their own headers, so until this existed a caregiver could be reading — and
 * on `reading/[id]`, **deleting** — someone else's measurement with nothing on
 * screen saying whose. Smaller than the original gap, because you can only
 * reach those from a tab that did show the banner, but the same class of
 * error: the screen someone forgets is the screen where the mistake happens.
 *
 * ## What it deliberately does not carry
 *
 * **No exit and no switcher.** The tab banner has both; this one is
 * informational only. Leaving a patient from inside `reading/[id]` would
 * strand the user on a detail screen for a reading they can no longer read,
 * and switching patients under a route keyed by *this* patient's reading id
 * is worse. The controls stay one back-gesture away, where the route they
 * apply to is the one being displayed.
 *
 * ## Safe area
 *
 * It needs none, unlike the tab banner. That one sits *above* the navigator
 * and therefore owns `insets.top`, which is why `app/(tabs)/_layout.tsx` has
 * to hand children a zeroed inset context. Every route here renders inside
 * `GradientBackground`, which has already spent `insets.top` before its
 * children mount — so this is an ordinary strip and adding an inset would put
 * a second status-bar gap on all five screens.
 *
 * Renders nothing for a patient account, and nothing for a caregiver who has
 * not entered anyone.
 */
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { palette } from '@/theme';

import { useActivePatient } from '../hooks/use-active-patient';

export function CompactPatientBanner() {
  const { patient, isViewingPatient } = useActivePatient();

  if (!isViewingPatient) return null;

  const name = patient ? `คุณ${patient.firstname}` : 'ผู้ป่วย';

  return (
    <View
      testID="compact-patient-banner"
      // Purple in both schemes, matching `ActivePatientBanner`. This says "you
      // are not in your own account" and must not soften into either theme's
      // background.
      className="flex-row items-center px-4 py-1.5"
      style={{ backgroundColor: palette.purple }}
      accessibilityRole="text"
      accessibilityLabel={`กำลังดูข้อมูลของ ${name}`}
    >
      <Ionicons name="eye-outline" size={14} color="#FFFFFF" />
      <ThemedText
        type="label"
        weight="semibold"
        numberOfLines={1}
        // White on a filled purple surface — its contrast pair, not a token,
        // so it goes through `style` rather than `themeColor`.
        style={{ color: '#FFFFFF' }}
        className="ml-1.5 flex-1"
      >
        {`กำลังดูข้อมูลของ ${name}`}
      </ThemedText>
    </View>
  );
}
