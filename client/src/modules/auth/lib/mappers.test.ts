import { sessionFromGql, userFromGql, type UserPayload } from './mappers';

const basePayload: UserPayload = {
  id: 'u1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  role: 'patient',
  createdAt: '2026-01-15T08:30:00.000Z',
};

describe('userFromGql', () => {
  it('converts GraphQL nulls to absent rather than null', () => {
    // `email: null` in an optional field reads as "present but empty" at
    // every call site downstream — `user.email ?? fallback` stops working.
    const user = userFromGql({ ...basePayload, email: null, avatar: null, weight: null });

    expect(user.email).toBeUndefined();
    expect(user.avatar).toBeUndefined();
    expect(user.weight).toBeUndefined();
    expect('email' in user).toBe(true);
  });

  it('parses dates into Date objects', () => {
    const user = userFromGql({ ...basePayload, dob: '1960-03-02T00:00:00.000Z' });

    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.dob?.getUTCFullYear()).toBe(1960);
  });

  it('keeps zero as a real weight', () => {
    // A `|| undefined` here would silently drop it.
    expect(userFromGql({ ...basePayload, weight: 0 }).weight).toBe(0);
  });

  it('degrades an unknown role to patient instead of throwing', () => {
    // `role` is a plain String! on the wire, so a gateway that adds a role
    // before the app ships must not crash a screen.
    expect(userFromGql({ ...basePayload, role: 'superadmin' }).role).toBe('patient');
  });

  it('keeps the roles it does know', () => {
    expect(userFromGql({ ...basePayload, role: 'caregiver' }).role).toBe('caregiver');
    expect(userFromGql({ ...basePayload, role: 'developer' }).role).toBe('developer');
  });

  it('drops a gender outside the allowed set', () => {
    expect(userFromGql({ ...basePayload, gender: 'unspecified' }).gender).toBeUndefined();
    expect(userFromGql({ ...basePayload, gender: 'female' }).gender).toBe('female');
  });
});

describe('sessionFromGql', () => {
  it('maps a revoked session with its revocation time', () => {
    const session = sessionFromGql({
      id: 's1',
      deviceLabel: 'Android App',
      isActive: false,
      revokedAt: '2026-07-30T10:00:00.000Z',
      lastActiveAt: '2026-07-30T09:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    expect(session.isActive).toBe(false);
    expect(session.revokedAt).toBeInstanceOf(Date);
    expect(session.userAgent).toBeUndefined();
  });

  it('leaves revokedAt absent for a live session', () => {
    const session = sessionFromGql({
      id: 's2',
      isActive: true,
      revokedAt: null,
      lastActiveAt: '2026-07-31T09:00:00.000Z',
      createdAt: '2026-07-31T08:00:00.000Z',
    });

    expect(session.revokedAt).toBeUndefined();
  });
});
