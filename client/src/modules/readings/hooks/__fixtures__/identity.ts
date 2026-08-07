/**
 * The identity the readings hooks read, in one place.
 *
 * Six of the seven hooks tested beside this file reach for `useSession`,
 * `useSubject`, or `useActivePatient`, and **none of them takes any of it as
 * a parameter** — `modules/caregivers/hooks/use-subject.ts` explains why the
 * subject is resolved once rather than passed down. A consequence for tests:
 * "a caregiver viewing a patient" cannot be set up by calling the hook
 * differently, only by replacing those two modules. So the replacement lives
 * here instead of being retyped in seven files that would then drift.
 *
 * Jest gives every test file its own module registry, so the `identity`
 * object below is private to whichever suite required it. Mutating it in one
 * file cannot reach another.
 *
 * Both mock factories are **functions**, and every field they expose reads
 * `identity` at call time. A `jest.mock` factory is hoisted above the imports
 * of the file that uses it, so anything it dereferences while being defined
 * is still in its temporal dead zone — capturing `identity.userId` eagerly
 * would freeze `undefined` in place forever.
 */

export type TestUser = {
  id: string;
  firstname: string | null;
  lastname: string | null;
  role: 'patient' | 'caregiver';
};

export type TestPatient = {
  id: string;
  firstname: string | null;
  lastname: string | null;
};

export type Identity = {
  userId: string | null;
  isAuthenticated: boolean;
  user: TestUser | null;
  /** `undefined`, never `null` — see `use-active-patient.ts`. */
  viewingPatientId: string | undefined;
  patient: TestPatient | null;
};

export const SELF: TestUser = {
  id: 'u1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  role: 'patient',
};

export const CAREGIVER: TestUser = {
  id: 'c1',
  firstname: 'มานี',
  lastname: 'รักดี',
  role: 'caregiver',
};

export const PATIENT: TestPatient = {
  id: 'p9',
  firstname: 'สมหญิง',
  lastname: 'มีสุข',
};

/** Mutate this in a test; call `resetIdentity()` in `beforeEach`. */
export const identity: Identity = {
  userId: SELF.id,
  isAuthenticated: true,
  user: SELF,
  viewingPatientId: undefined,
  patient: null,
};

/** A signed-in patient acting on their own data — the default. */
export function resetIdentity(): void {
  identity.userId = SELF.id;
  identity.isAuthenticated = true;
  identity.user = SELF;
  identity.viewingPatientId = undefined;
  identity.patient = null;
}

/** A caregiver with `PATIENT` open. */
export function actAsCaregiverViewingPatient(): void {
  identity.userId = CAREGIVER.id;
  identity.isAuthenticated = true;
  identity.user = CAREGIVER;
  identity.viewingPatientId = PATIENT.id;
  identity.patient = PATIENT;
}

/** Nobody signed in. */
export function actAsSignedOut(): void {
  identity.userId = null;
  identity.isAuthenticated = false;
  identity.user = null;
  identity.viewingPatientId = undefined;
  identity.patient = null;
}

/** Replacement for the `@/modules/auth` barrel. */
export const authModuleMock = () => ({
  useSession: () => ({
    status: identity.isAuthenticated ? 'authenticated' : 'unauthenticated',
    userId: identity.userId,
    isAuthenticated: identity.isAuthenticated,
    user: identity.user,
    isLoadingUser: false,
  }),
});

/**
 * Replacement for the `@/modules/caregivers` barrel.
 *
 * `useSubject`'s three-line derivation is restated here rather than imported,
 * because importing the real one drags in the barrel this factory exists to
 * replace. That the derivation itself is correct is
 * `caregivers/hooks/use-subject.test.tsx`'s job, not these suites' — what
 * they assert is what each readings hook *does* with the answer.
 */
export const caregiversModuleMock = () => ({
  useActivePatient: () => ({
    patient: identity.patient,
    viewingPatientId: identity.viewingPatientId,
    isViewingPatient: identity.viewingPatientId !== undefined,
    setActivePatient: () => {},
    clearActivePatient: () => {},
  }),
  useSubject: () => ({
    subjectId: identity.viewingPatientId ?? identity.userId ?? '',
    isSelf: !identity.viewingPatientId,
    patient: identity.viewingPatientId ? identity.patient : null,
    patientIdArg: identity.viewingPatientId,
  }),
});
