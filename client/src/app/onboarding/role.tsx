/**
 * Pick a role — the one onboarding step that runs *after* authentication.
 *
 * It stays there because it writes to the server (`User.roleSelectedAt`) and
 * so needs a session to write with. Display setup, which writes only to
 * AsyncStorage, moved ahead of login for the reasons in
 * `modules/auth/route-gate.ts`. That leaves this as a standalone step rather
 * than "1 of 2".
 *
 * This is where the role is chosen for *every* sign-up path. It is not in
 * the registration form on purpose: a Google sign-up never sees
 * `RegisterInput`, so a form field would have left OAuth users permanently
 * patients. See docs/project/CLIENT-onboarding.md.
 *
 * No skip button. `role` decides which app the user gets, and a default
 * chosen by silence is the one outcome that cannot be corrected by someone
 * who does not know the setting exists.
 */
import { router } from 'expo-router';
import { useState } from 'react';

import { AuthErrorBanner } from '@/modules/auth/components/auth-error-banner';
import { useSelectRole, type SelectableRole } from '@/modules/onboarding';
import { ChoiceCard } from '@/modules/onboarding/components/choice-card';
import { OnboardingShell } from '@/modules/onboarding/components/onboarding-shell';

const ROLES: {
  value: SelectableRole;
  title: string;
  description: string;
  icon: 'heart-outline' | 'people-outline';
}[] = [
  {
    value: 'patient',
    title: 'ผู้ป่วย',
    description: 'บันทึกความดันของตัวเอง และดูแนวโน้มย้อนหลัง',
    icon: 'heart-outline',
  },
  {
    value: 'caregiver',
    title: 'ผู้ดูแล',
    description: 'ดูแลผู้ป่วยที่บ้านหรือหน่วยงาน บันทึกค่าแทนได้เมื่อผู้ป่วยอนุญาต',
    icon: 'people-outline',
  },
];

export default function OnboardingRoleScreen() {
  const [selected, setSelected] = useState<SelectableRole | null>(null);
  const { selectRole, isPending, error, clearError } = useSelectRole();

  const handleContinue = async () => {
    if (!selected || isPending) return;

    try {
      await selectRole(selected);
      /*
       * Straight into the app. Display setup used to follow this step; it now
       * runs *before* login (see `modules/auth/route-gate.ts`), so by the time
       * anyone reaches the role question the device is already configured.
       *
       * The hook has already written `roleSelectedAt` into the `me` cache, so
       * the gate sees this step as done.
       */
      router.replace('/(tabs)');
    } catch {
      // Rendered from `error` below.
    }
  };

  return (
    <OnboardingShell
      step={1}
      totalSteps={1}
      title="คุณใช้แอปในบทบาทใด"
      subtitle="เลือกให้ตรงกับการใช้งานของคุณ เปลี่ยนภายหลังได้ในหน้าตั้งค่า"
      actionTitle="ถัดไป"
      actionTestID="onboarding-role-continue"
      onAction={handleContinue}
      actionDisabled={!selected}
      actionLoading={isPending}>
      {error ? <AuthErrorBanner message={error.message} /> : null}

      {ROLES.map((role) => (
        <ChoiceCard
          key={role.value}
          testID={`onboarding-role-${role.value}`}
          title={role.title}
          description={role.description}
          icon={role.icon}
          selected={selected === role.value}
          onPress={() => {
            setSelected(role.value);
            clearError();
          }}
        />
      ))}
    </OnboardingShell>
  );
}
