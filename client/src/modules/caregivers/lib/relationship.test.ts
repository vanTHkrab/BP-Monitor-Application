/**
 * Caregiver relationship labels and the picker's option list.
 *
 * The invariant with the sharpest failure mode is the one at the top of
 * `relationship.ts`: this list must stay in step with `VALID_RELATIONSHIPS` in
 * the gateway's `caregiver.service.ts`. Offering a value the server rejects is
 * not a validation error — the server normalises it to `other` and returns
 * 200, so the invite the patient is asked to trust says something the
 * caregiver never chose. The list is asserted literally here so a one-sided
 * edit has to touch this file too.
 */
import {
  DEFAULT_RELATIONSHIP,
  RELATIONSHIP_OPTIONS,
  parseRelationship,
  relationshipLabel,
} from './relationship';

describe('RELATIONSHIP_OPTIONS', () => {
  it('is exactly the gateway allow-list, in the order the form offers it', () => {
    // Mirrors VALID_RELATIONSHIPS in
    // server/app/api-gateway/src/caregiver/caregiver.service.ts. `patient` is
    // deliberately absent — the gateway rejects it on the way in.
    expect(RELATIONSHIP_OPTIONS).toEqual([
      'child',
      'spouse',
      'parent',
      'sibling',
      'friend',
      'caregiver',
      'caregiver_professional',
      'other',
    ]);
  });

  it('never offers `patient`, which the column cannot mean', () => {
    expect(RELATIONSHIP_OPTIONS).not.toContain('patient');
  });

  it('ends with `other`, the answer you pick after failing to find yours', () => {
    expect(RELATIONSHIP_OPTIONS.at(-1)).toBe('other');
  });

  it('offers no duplicates', () => {
    expect(new Set(RELATIONSHIP_OPTIONS).size).toBe(RELATIONSHIP_OPTIONS.length);
  });

  it('gives every offered option its own distinct label', () => {
    // Two options rendering the same Thai string is an unpickable form.
    const labels = RELATIONSHIP_OPTIONS.map(relationshipLabel);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('defaults to an option the picker actually offers', () => {
    expect(RELATIONSHIP_OPTIONS).toContain(DEFAULT_RELATIONSHIP);
    expect(DEFAULT_RELATIONSHIP).toBe('child');
  });
});

describe('relationshipLabel', () => {
  it.each([
    ['parent', 'พ่อ/แม่'],
    ['child', 'ลูก'],
    ['spouse', 'คู่สมรส'],
    ['sibling', 'พี่/น้อง'],
    ['friend', 'เพื่อน'],
    ['caregiver', 'ผู้ดูแล'],
    ['caregiver_professional', 'ผู้ดูแลวิชาชีพ'],
    ['other', 'อื่น ๆ'],
  ])('labels %s', (value, label) => {
    expect(relationshipLabel(value)).toBe(label);
  });

  it('still renders a legacy `patient` row as a word', () => {
    // Kept so a row written before the gateway rejected this value does not
    // show up blank in someone's caregiver list.
    expect(relationshipLabel('patient')).toBe('ผู้ป่วย');
  });

  it.each([null, undefined, '', 'nurse', 'FAMILY'])(
    'degrades %p to อื่น ๆ rather than showing a raw enum name',
    (value) => {
      expect(relationshipLabel(value)).toBe('อื่น ๆ');
    },
  );
});

describe('parseRelationship', () => {
  it.each([
    'parent',
    'child',
    'spouse',
    'sibling',
    'friend',
    'caregiver',
    'caregiver_professional',
    'other',
    'patient',
  ])('narrows the known server value %s to itself', (value) => {
    // `patient` included on purpose: the server can still return it for an
    // old row, and mapping it to `other` here would relabel existing data.
    expect(parseRelationship(value)).toBe(value);
  });

  it.each([null, undefined, '', 'nurse', 'Child'])('falls back to other for %p', (value) => {
    expect(parseRelationship(value)).toBe('other');
  });

  it('resolves an inherited Object property as if it were a relationship', () => {
    // Characterization, not a live bug — recorded rather than fixed, because
    // this batch does not change production code.
    //
    // Both functions guard with `value in LABELS`, which walks the prototype
    // chain, so 'toString' and 'constructor' pass as relationship values.
    // `relationshipLabel` then resolves them to `LABELS['toString']`, and
    // since a function is not nullish the `?? LABELS.other` fallback does not
    // fire — the return value is a function object, not a string, despite the
    // `: string` signature.
    //
    // **Reachability, stated at its true width:** no such value can arrive
    // from the gateway today. `RelationshipType` is a Postgres enum
    // (schema.prisma:87) and `CaregiverPatient.relationship` is typed to it,
    // so the column cannot physically hold 'toString'; caregiver.service.ts
    // additionally normalises every write through `VALID_RELATIONSHIPS.has()`.
    // GraphQL exposes the field as `String!`, which is the only reason the
    // client looks exposed. So the defect is that these functions are unsafe
    // for untrusted input while being typed as if they were not, and the sole
    // thing preventing it today is a server-side enum the client does not own
    // and cannot see. That is a thin guarantee to leave a `: string` signature
    // resting on, which is the argument for fixing it — not a patient-facing
    // bug.
    //
    // `Object.hasOwn(LABELS, value)` in both functions closes it. Reported to
    // expo-dev; **update** these assertions in the same change as the fix,
    // do not delete them — they become the proof the guard works.
    expect(parseRelationship('toString')).toBe('toString');
    expect(typeof relationshipLabel('toString')).not.toBe('string');
  });

  it('round-trips every offered option through label and parse', () => {
    for (const option of RELATIONSHIP_OPTIONS) {
      expect(parseRelationship(option)).toBe(option);
      expect(relationshipLabel(option)).not.toBe(option);
    }
  });
});
