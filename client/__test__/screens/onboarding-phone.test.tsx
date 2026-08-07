/**
 * Add a phone number — the step a Google sign-up lands on, since OAuth never
 * supplies one.
 *
 * No query, so no loading or empty state. Two things are pure render state:
 * the server error banner, and the pending flag on the submit button. The
 * field-level validation errors are set by submitting, which is an
 * interaction and out of scope for this batch.
 *
 * The line worth keeping is the subtitle. The phone number is what lets a
 * caregiver *find* this account — asking for one with no stated reason is how
 * a screen reads as a data grab, and the sentence is the only thing on it
 * that explains the ask.
 */
const mockSetPhone = {
  current: {
    setPhone: jest.fn(),
    isPending: false,
    error: null as Error | null,
    clearError: jest.fn(),
  },
};
jest.mock('@/modules/auth', () => ({
  useSetPhone: () => mockSetPhone.current,
}));

import OnboardingPhoneScreen from '@/app/(auth)/onboarding-phone';
import { renderScreen } from '../test-utils';

beforeEach(() => {
  jest.clearAllMocks();
  mockSetPhone.current = {
    setPhone: jest.fn(),
    isPending: false,
    error: null,
    clearError: jest.fn(),
  };
});

describe('OnboardingPhoneScreen', () => {
  it('renders the field and states why the number is wanted', async () => {
    const view = await renderScreen(<OnboardingPhoneScreen />);

    expect(view.getByTestId('onboarding-phone-input')).toBeOnTheScreen();
    expect(view.getByTestId('onboarding-phone-submit')).toBeOnTheScreen();
    expect(view.getByText('ใช้สำหรับให้ผู้ดูแลค้นหาบัญชีของคุณ')).toBeOnTheScreen();
  });

  it('shows no banner before anything has failed', async () => {
    const view = await renderScreen(<OnboardingPhoneScreen />);

    expect(view.queryByText('เบอร์นี้ถูกใช้ไปแล้ว')).toBeNull();
  });

  // The likely server error here is a number already claimed by another
  // account, which the user can only resolve if they are told.
  it('surfaces a server error as a banner', async () => {
    mockSetPhone.current.error = new Error('เบอร์นี้ถูกใช้ไปแล้ว');
    const view = await renderScreen(<OnboardingPhoneScreen />);

    expect(view.getByText('เบอร์นี้ถูกใช้ไปแล้ว')).toBeOnTheScreen();
  });

  // Blocked in flight so a double tap cannot send the number twice.
  it('blocks the submit while the number is being saved', async () => {
    mockSetPhone.current.isPending = true;
    const view = await renderScreen(<OnboardingPhoneScreen />);

    expect(view.getByTestId('onboarding-phone-submit')).toBeDisabled();
  });
});
