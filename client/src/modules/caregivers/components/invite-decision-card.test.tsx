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

import { PERMISSION_OPTIONS } from '../lib/permission';
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
  permission: 'full',
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

    // Read off `lib/permission.ts` rather than a literal. That file owns the
    // wording and this card's job is to *show* it — a copy here would let the
    // two drift, and the drift would be invisible because both would still
    // render a plausible Thai sentence.
    for (const option of PERMISSION_OPTIONS) {
      expect(view.getByText(option.consequence)).toBeTruthy();
    }
  });

  /**
   * `full` now also covers editing the patient's five health fields, and the
   * consequence has to say so **here**, on the card where the grant is made.
   *
   * Reusing `full` rather than adding a permission level retroactively widens
   * what patients who already granted it agreed to; what makes that
   * defensible is that they can downgrade at any time, which only works if
   * they know what they are choosing. This sentence is the consent, not a
   * description of it — asserted separately from the loop above so that
   * dropping the health clause fails with the reason attached.
   */
  it('tells the patient that "บันทึกแทนได้" now includes their health information', async () => {
    const { view } = await renderCard();

    const full = PERMISSION_OPTIONS.find((option) => option.value === 'full');
    expect(full?.consequence).toContain('แก้ไขข้อมูลสุขภาพ');
    // Named, not summarised: "what exactly can they change?" is the question
    // someone weighing this actually has.
    expect(full?.consequence).toContain('โรคประจำตัว');
    // And the exclusion, which is the reason the gateway gave this path its
    // own input type.
    expect(full?.consequence).toContain('แก้อีเมลและเบอร์โทรศัพท์ไม่ได้');
    expect(view.getByText(full?.consequence ?? '')).toBeTruthy();
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
