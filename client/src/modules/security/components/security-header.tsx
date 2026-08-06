/**
 * The back bar every pushed route shares.
 *
 * Extracted rather than repeated: the back affordance is the only way out of
 * these screens on iOS, and a copy per screen is a chance for one to drift or
 * lose its accessibility label. It has outgrown `modules/security` — twelve
 * routes use it and only five are security screens — but moving it is a rename
 * across all of them and not this change's job.
 *
 * ## `subject` is required on purpose
 *
 * These routes sit *above* the tab navigator, so `ActivePatientBanner` — which
 * is mounted inside `app/(tabs)/_layout.tsx` — does not reach them. Some of
 * them read patient-scoped data anyway (`reading/[id]` also **deletes** it,
 * `settings` exports the whole history), so they have to say whose data is on
 * screen. The rest are firmly the signed-in user's own account, and a banner
 * claiming otherwise over "เปลี่ยนรหัสผ่าน" is a worse lie than no banner.
 *
 * There is no safe default between those two, so there is no default. A new
 * route cannot mount this header without answering the question, and it is
 * answered where the answer is knowable — at the call site, next to the hooks
 * that decide whose data the screen reads. Same reasoning as
 * `respondToInvite`'s required `permission`: an argument the caller can forget
 * is one that will be forgotten, and the failure is silent.
 *
 * The banner still renders nothing unless a caregiver is actually inside a
 * patient, so `subject="patient"` means "show it when there is one", not
 * "always show it".
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { CompactPatientBanner } from '@/modules/caregivers';

export type SecurityHeaderProps = {
  title: string;
  /**
   * Whose data this screen is about.
   *
   * `'patient'` — reads or writes data scoped to the active patient, so the
   * caregiver banner belongs here. `'self'` — the signed-in user's own
   * account, where the banner would misdescribe the screen.
   */
  subject: 'patient' | 'self';
};

export function SecurityHeader({ title, subject }: SecurityHeaderProps) {
  const colors = useTheme();

  return (
    <View>
      {subject === 'patient' ? <CompactPatientBanner /> : null}

      <View className="flex-row items-center px-4 py-4">
        <TouchableOpacity
          onPress={() => router.back()}
          className="mr-4 items-center justify-center"
          // 48dp hit area around a 28px glyph.
          style={{ minWidth: 48, minHeight: 48 }}
          accessibilityRole="button"
          accessibilityLabel="ย้อนกลับ"
        >
          <Ionicons name="arrow-back" size={28} color={colors['text-primary']} />
        </TouchableOpacity>

        <ThemedText type="heading" weight="bold" numberOfLines={1} className="flex-1 text-center">
          {title}
        </ThemedText>

        {/* Balances the back button so the title stays optically centred. */}
        <View style={{ width: 48 }} />
      </View>
    </View>
  );
}
