/**
 * The relationship chip grid.
 *
 * The list it offers is a **cross-process contract**: `RELATIONSHIP_OPTIONS`
 * must stay in step with `VALID_RELATIONSHIPS` in the gateway's
 * `caregiver.service.ts`. Offering a value the server rejects is not a
 * validation error — the server stores `other` and returns 200, so the invite
 * the patient sees says something the caregiver never chose. Iterating the
 * exported list rather than restating it here is what keeps this test from
 * being a second place that can drift.
 *
 * The picker also drops `OptionRow`'s clearable behaviour because the field is
 * required, which is why there is no "nothing selected" case to assert.
 */
import { RelationshipPicker } from '@/modules/caregivers/components/relationship-picker';
import { RELATIONSHIP_OPTIONS, relationshipLabel } from '@/modules/caregivers/lib/relationship';
import { renderScreen } from '../test-utils';

const noop = () => {};

describe('RelationshipPicker', () => {
  it('offers every relationship the gateway accepts', async () => {
    const view = await renderScreen(
      <RelationshipPicker label="ความสัมพันธ์" value="child" onChange={noop} />,
    );

    for (const option of RELATIONSHIP_OPTIONS) {
      expect(view.getByTestId(`relationship-${option}`)).toBeOnTheScreen();
      expect(view.getByText(relationshipLabel(option))).toBeOnTheScreen();
    }
  });

  // Never `patient`. The gateway rejects it on the way in — the column says
  // how the caregiver relates *to* the patient, and "patient" is not an
  // answer to that.
  it('does not offer the value the gateway refuses', async () => {
    const view = await renderScreen(
      <RelationshipPicker label="ความสัมพันธ์" value="child" onChange={noop} />,
    );

    expect(view.queryByTestId('relationship-patient')).toBeNull();
  });

  it('renders the field label', async () => {
    const view = await renderScreen(
      <RelationshipPicker label="ความสัมพันธ์" value="child" onChange={noop} />,
    );

    expect(view.getByText('ความสัมพันธ์')).toBeOnTheScreen();
  });

  it('marks exactly one chip as chosen', async () => {
    const view = await renderScreen(
      <RelationshipPicker label="ความสัมพันธ์" value="spouse" onChange={noop} />,
    );

    expect(view.getByTestId('relationship-spouse')).toBeSelected();
    for (const other of RELATIONSHIP_OPTIONS.filter((option) => option !== 'spouse')) {
      expect(view.getByTestId(`relationship-${other}`)).not.toBeSelected();
    }
  });

  describe('disabled', () => {
    // The whole grid goes at once — a form submitting must not let the user
    // change the relationship the request is already carrying.
    it('disables every chip', async () => {
      const view = await renderScreen(
        <RelationshipPicker label="ความสัมพันธ์" value="child" onChange={noop} disabled />,
      );

      for (const option of RELATIONSHIP_OPTIONS) {
        expect(view.getByTestId(`relationship-${option}`)).toBeDisabled();
      }
    });

    it('leaves them all enabled otherwise', async () => {
      const view = await renderScreen(
        <RelationshipPicker label="ความสัมพันธ์" value="child" onChange={noop} />,
      );

      for (const option of RELATIONSHIP_OPTIONS) {
        expect(view.getByTestId(`relationship-${option}`)).not.toBeDisabled();
      }
    });
  });
});
