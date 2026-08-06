import { deriveSections, isEmpty, linkKey } from './sections';
import type { CaregiverLink } from '../types';

const link = (over: Partial<CaregiverLink>): CaregiverLink => ({
  caregiverId: 'c1',
  patientId: 'p1',
  relationship: 'child',
  caregiverName: 'สมชาย ใจดี',
  caregiverPhone: '0812345678',
  patientName: 'สมหญิง ใจดี',
  permission: 'full',
  patientPhone: '0898765432',
  status: 'pending',
  ...over,
});

describe('deriveSections', () => {
  it('puts a pending invite addressed to me in invitesToAnswer', () => {
    const sections = deriveSections([link({ status: 'pending' })], 'p1');

    expect(sections.invitesToAnswer).toHaveLength(1);
    expect(sections.sentInvites).toHaveLength(0);
  });

  it('puts a pending invite I sent in sentInvites', () => {
    const sections = deriveSections([link({ status: 'pending' })], 'c1');

    expect(sections.sentInvites).toHaveLength(1);
    expect(sections.invitesToAnswer).toHaveLength(0);
  });

  it('splits accepted links by which side the user is on', () => {
    const links = [
      link({ status: 'accepted' }),
      link({ caregiverId: 'p1', patientId: 'x9', status: 'accepted' }),
    ];

    expect(deriveSections(links, 'p1').myCaregivers).toHaveLength(1);
    expect(deriveSections(links, 'p1').myPatientLinks).toHaveLength(1);
  });

  // The regression this file exists for: client-old branched on role, so a
  // patient's own sent invite was invisible to them.
  it('shows both directions for a user who is on both sides', () => {
    const sections = deriveSections(
      [
        link({ caregiverId: 'c1', patientId: 'me', status: 'pending' }),
        link({ caregiverId: 'me', patientId: 'p9', status: 'pending' }),
      ],
      'me',
    );

    expect(sections.invitesToAnswer).toHaveLength(1);
    expect(sections.sentInvites).toHaveLength(1);
  });

  it('drops rejected links from every section', () => {
    const sections = deriveSections([link({ status: 'rejected' })], 'p1');

    expect(isEmpty(sections)).toBe(true);
  });

  it('returns empty sections before the user id is known', () => {
    expect(isEmpty(deriveSections([link({})], null))).toBe(true);
  });
});

describe('linkKey', () => {
  it('keys on the caregiver/patient pair', () => {
    expect(linkKey(link({}))).toBe('c1:p1');
  });
});
