/**
 * Splits the one symmetric link list into the four things the screen shows.
 *
 * Derived from `userId`, not from `user.role`. client-old branched the whole
 * screen on `role === 'caregiver'`, which meant a patient who had also
 * invited someone — the gateway allows it, `addCaregiverPatient` has no role
 * check — could not see or cancel their own sent invite, and a caregiver
 * could not see or answer an invite addressed to them. Which side of a row
 * you are on is a property of the row, so it is read from the row.
 *
 * `role` still decides whether the invite *form* is offered, because that is
 * a question about what this account is for, not about what already exists.
 */
import type { CaregiverLink } from '../types';

export type CaregiverSections = {
  /** Invites waiting on this user's answer. Rendered first — it is the only
   *  section with a decision in it. */
  invitesToAnswer: CaregiverLink[];
  /** Accepted caregivers of this user. */
  myCaregivers: CaregiverLink[];
  /** Accepted patients of this user, as links. The screen prefers
   *  `myPatients` for these (it carries avatars); this is the fallback while
   *  that query is still loading, and the reconciliation check. */
  myPatientLinks: CaregiverLink[];
  /** Invites this user sent that nobody has answered yet. */
  sentInvites: CaregiverLink[];
};

export function deriveSections(links: CaregiverLink[], userId: string | null): CaregiverSections {
  const empty: CaregiverSections = {
    invitesToAnswer: [],
    myCaregivers: [],
    myPatientLinks: [],
    sentInvites: [],
  };

  if (!userId) return empty;

  return links.reduce<CaregiverSections>((sections, link) => {
    const isPatientSide = link.patientId === userId;
    const isCaregiverSide = link.caregiverId === userId;

    if (isPatientSide && link.status === 'pending') sections.invitesToAnswer.push(link);
    if (isPatientSide && link.status === 'accepted') sections.myCaregivers.push(link);
    if (isCaregiverSide && link.status === 'accepted') sections.myPatientLinks.push(link);
    if (isCaregiverSide && link.status === 'pending') sections.sentInvites.push(link);

    // Rejected rows are deliberately in no section. The gateway keeps them so
    // the same caregiver cannot re-invite past a decline (`add` throws
    // CONFLICT on any existing row), but showing a patient a list of invites
    // they already turned down asks them to decide again every visit.
    return sections;
  }, empty);
}

/** True when there is nothing at all to show — drives the empty state. */
export function isEmpty(sections: CaregiverSections): boolean {
  return (
    sections.invitesToAnswer.length === 0 &&
    sections.myCaregivers.length === 0 &&
    sections.myPatientLinks.length === 0 &&
    sections.sentInvites.length === 0
  );
}

/** Stable key for a link — the pair is the gateway's primary key. */
export const linkKey = (link: CaregiverLink): string =>
  `${link.caregiverId}:${link.patientId}`;
