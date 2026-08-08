/**
 * First-run display setup — the app's **first** screen, before login.
 *
 * Everything here is device-local, which is why the step is gated on a local
 * flag rather than a server column: after a reinstall these really are gone,
 * and asking again is correct.
 *
 * ## Why it runs before authentication
 *
 * It used to run after login and after role selection. That ordering asked a
 * user who cannot read small text to read a login form first, in order to
 * reach the control that fixes small text — the login and register screens are
 * themselves text. The gate now puts this first; the argument is written out
 * in `modules/auth/route-gate.ts`.
 *
 * The consequence to keep in mind here: **the user may not be signed in.**
 * Nothing on this screen may touch the network or the session, and the button
 * cannot route to `/(tabs)`. It hands back to the entry route, which re-runs
 * `resolveGate` and sends a signed-out first-run user to `/login`.
 *
 * ## Why it builds nothing of its own
 *
 * This screen used to carry its own `THEMES`, `FONT_LABELS`, and
 * `PREVIEW_SIZE` tables and its own card markup. They had already drifted from
 * `app/settings.tsx`: the medium font rung was `ปกติ` here and `มาตรฐาน` there,
 * so the same setting had two names depending on which door you came through.
 * It now renders the same `SettingCard` around the same three pickers that
 * settings does, so there is nothing left to drift.
 */
import { router } from 'expo-router';

import { FontFamilyPicker } from '@/components/ui/font-family-picker';
import { FontSizePicker } from '@/components/ui/font-size-picker';
import { SettingCard } from '@/components/ui/setting-card';
import { ThemePicker } from '@/components/ui/theme-picker';
import { OnboardingShell } from '@/modules/onboarding/components/onboarding-shell';
import { usePreferencesStore } from '@/stores';

export default function OnboardingSetupScreen() {
  const completeSetup = usePreferencesStore((state) => state.completeSetup);

  const handleFinish = async () => {
    await completeSetup();
    /*
     * Back to the entry route, **not** to `/(tabs)`.
     *
     * This step now runs before authentication, so "done" does not mean "into
     * the app": a first-run user who has not signed in belongs on `/login`,
     * and one who has but has not picked a role belongs on `/onboarding/role`.
     * `app/index.tsx` re-runs `resolveGate` with the flag this call just set
     * and answers that question in the one place it is written down.
     * Hardcoding a destination here would be a second copy of the routing rule
     * — and the copy that a signed-out user hits first.
     */
    router.replace('/');
  };

  return (
    <OnboardingShell
      /*
       * A standalone step, not "2 of 2". Setup sits before authentication and
       * role selection sits after it, with a login screen in between that this
       * shell knows nothing about — so there is no total to count towards. The
       * old "ขั้นที่ 2 จาก 2" was wrong the moment the gate was reordered.
       */
      step={1}
      totalSteps={1}
      title="ตั้งค่าการแสดงผล"
      subtitle="ปรับให้อ่านสบายตาที่สุด เปลี่ยนภายหลังได้ในหน้าตั้งค่า"
      actionTitle="ถัดไป"
      actionTestID="onboarding-setup-finish"
      onAction={handleFinish}>
      {/* The same three cards as `app/settings.tsx`. Change the picker or the
          card, never one of the two screens. */}
      <SettingCard
        testID="onboarding-theme"
        icon="color-palette-outline"
        title="ธีม"
        description="เลือกโหมดสว่าง มืด หรือให้เปลี่ยนตามเครื่อง">
        <ThemePicker />
      </SettingCard>

      <SettingCard
        testID="onboarding-font-size"
        icon="text-outline"
        title="ขนาดตัวหนังสือ"
        description="ปรับจากหน้านี้แล้วให้หน้าหลักของแอปเปลี่ยนตาม"
        accent="purple">
        <FontSizePicker />
      </SettingCard>

      <SettingCard
        testID="onboarding-font-family"
        icon="text"
        title="แบบตัวหนังสือ"
        description="เลือกหน้าตาตัวอักษรที่อ่านสบายตาที่สุดสำหรับคุณ"
        accent="purple">
        <FontFamilyPicker />
      </SettingCard>
    </OnboardingShell>
  );
}
