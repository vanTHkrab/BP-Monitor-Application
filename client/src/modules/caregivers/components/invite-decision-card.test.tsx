/**
 * The permission grant is made here, and nowhere else in the app.
 *
 * These assert the two things that would be invisible if wrong: that the
 * selected grant is what reaches `onRespond`, and that the sentence above the
 * buttons describes the option currently selected. The card shipped saying
 * "และบันทึกค่าแทนคุณได้" unconditionally, so a view-only grant with the old
 * copy would tell the patient the opposite of what they were about to do.
 */
// Reached through `use-font-scale` → the preferences store, not by anything
// the card itself uses. Same shape as the banner's test next door.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

import type { CaregiverLink } from '../types';
import { InviteDecisionCard } from './invite-decision-card';
import { fireEvent, renderScreen } from '../../../../__test__/test-utils';

const CAREGIVER_ID = 'cg-1';

const link: CaregiverLink = {
  caregiverId: CAREGIVER_ID,
  patientId: 'pt-1',
  relationship: 'child',
  caregiverName: 'สมชาย ใจดี',
  caregiverPhone: '0810000000',
  patientName: 'สมหญิง ใจดี',
  patientPhone: '0820000000',
  status: 'pending',
};

const renderCard = async (onRespond = jest.fn()) => {
  const view = await renderScreen(
    <InviteDecisionCard link={link} onRespond={onRespond} />,
  );
  return { view, onRespond };
};

describe('InviteDecisionCard', () => {
  it('grants full by default, matching the column default', async () => {
    const { view, onRespond } = await renderCard();

    await fireEvent.press(view.getByTestId(`invite-accept-${CAREGIVER_ID}`));

    expect(onRespond).toHaveBeenCalledWith(true, 'full');
  });

  it('grants view when the patient picks ดูอย่างเดียว', async () => {
    const { view, onRespond } = await renderCard();

    await fireEvent.press(view.getByTestId(`invite-permission-view-${CAREGIVER_ID}`));
    await fireEvent.press(view.getByTestId(`invite-accept-${CAREGIVER_ID}`));

    expect(onRespond).toHaveBeenCalledWith(true, 'view');
  });

  // Both consequences are on screen at once, unselected included — that is
  // how a patient discovers the weaker grant exists at all. A design that
  // only describes the selected option hides the choice from anyone who
  // never taps.
  it('spells out what each option grants, chosen or not', async () => {
    const { view } = await renderCard();

    expect(view.getByText(/และบันทึกค่าความดันแทนคุณได้/)).toBeTruthy();
    expect(view.getByText(/แต่บันทึกค่าแทนคุณไม่ได้/)).toBeTruthy();
  });

  it('marks exactly one option as chosen, and moves it on tap', async () => {
    const { view } = await renderCard();

    const optionState = (option: 'view' | 'full') =>
      view.getByTestId(`invite-permission-${option}-${CAREGIVER_ID}`).props
        .accessibilityState.checked as boolean;

    expect(optionState('full')).toBe(true);
    expect(optionState('view')).toBe(false);

    await fireEvent.press(view.getByTestId(`invite-permission-view-${CAREGIVER_ID}`));

    expect(optionState('view')).toBe(true);
    expect(optionState('full')).toBe(false);
  });

  it('still reports a reject', async () => {
    const { view, onRespond } = await renderCard();

    await fireEvent.press(view.getByTestId(`invite-reject-${CAREGIVER_ID}`));

    expect(onRespond).toHaveBeenCalledWith(false, expect.any(String));
  });
});
