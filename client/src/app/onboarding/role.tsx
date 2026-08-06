/**
 * Onboarding step 1 — pick a role.
 *
 * This is where the role is chosen for *every* sign-up path. It is not in
 * the registration form on purpose: a Google sign-up never sees
 * `RegisterInput`, so a form field would have left OAuth users permanently
 * patients. See docs/todo/CLIENT-onboarding.md.
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
      // The hook has already written `roleSelectedAt` into the `me` cache, so
      // the gate on the next screen sees this step as done.
      router.replace('/onboarding/setup');
    } catch {
      // Rendered from `error` below.
    }
  };

  return (
    <OnboardingShell
      step={1}
      totalSteps={2}
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
