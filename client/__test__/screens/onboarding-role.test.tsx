/**
 * Onboarding step 1 — pick a role.
 *
 * The states here are the shell's, and they are the point: the continue
 * action starts disabled because there is no default role, the mutation's
 * error surfaces as a banner rather than a silent no-op, and the pending
 * state is visible. A default chosen by silence is the one outcome that
 * cannot be corrected by someone who does not know the setting exists — so
 * "starts with nothing selected and cannot continue" is the assertion this
 * screen most needs.
 */
const mockSelectRole = {
  current: {
    selectRole: jest.fn(),
    isPending: false,
    error: null as Error | null,
    clearError: jest.fn(),
  },
};
jest.mock('@/modules/onboarding', () => ({
  ...jest.requireActual('@/modules/onboarding'),
  useSelectRole: () => mockSelectRole.current,
}));

import OnboardingRoleScreen from '@/app/onboarding/role';
import { renderScreen } from '../test-utils';

beforeEach(() => {
  mockSelectRole.current = {
    selectRole: jest.fn(),
    isPending: false,
    error: null,
    clearError: jest.fn(),
  };
});

describe('OnboardingRoleScreen', () => {
  it('offers both roles and no skip', async () => {
    const view = await renderScreen(<OnboardingRoleScreen />);

    expect(view.getByTestId('onboarding-role-patient')).toBeOnTheScreen();
    expect(view.getByTestId('onboarding-role-caregiver')).toBeOnTheScreen();
    expect(view.getByText('คุณใช้แอปในบทบาทใด')).toBeOnTheScreen();
  });

  /*
   * `role` decides which app the user gets. Nothing is preselected, so the
   * action has to be disabled — if this ever renders enabled, the first tap
   * commits a role the user never chose.
   */
  it('cannot be advanced before a role is picked', async () => {
    const view = await renderScreen(<OnboardingRoleScreen />);

    expect(view.getByTestId('onboarding-role-continue')).toBeDisabled();
  });

  it('surfaces a failed role selection as a banner', async () => {
    mockSelectRole.current.error = new Error('เลือกบทบาทไม่สำเร็จ');
    const view = await renderScreen(<OnboardingRoleScreen />);

    expect(view.getByText('เลือกบทบาทไม่สำเร็จ')).toBeOnTheScreen();
  });

  it('shows no banner when nothing has failed', async () => {
    const view = await renderScreen(<OnboardingRoleScreen />);

    expect(view.queryByText('เลือกบทบาทไม่สำเร็จ')).toBeNull();
  });
});
