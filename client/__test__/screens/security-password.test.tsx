/**
 * Change password — render, then interaction.
 *
 * The render half of this file predates the interaction batch: it protects
 * copy that a redesign silently drops (the length floor stated *before* a
 * failure, and the warning that other devices get signed out). The rest of
 * the file drives the form, which is where everything this screen actually
 * does lives — validation, the submitted GraphQL variables, the in-flight
 * guard, the failure banner, and what is left on screen after a success.
 *
 * ## Where this mocks
 *
 * At `@/services/api`'s `graphqlRequest`, not at `useChangePassword`. Mocking
 * the hook is cheaper and proves less: `isPending` becomes a value the test
 * sets rather than a state the screen reaches, so "disabled while in flight"
 * degrades into "disabled when told to be". Going one layer lower runs the
 * real TanStack mutation, so the pending state is the real one, the rejection
 * path is the real one, and — the assertion worth the most here — the
 * variables on the wire are observable. A password screen that puts a field
 * it should not on the wire is a defect no render test can see.
 *
 * `SecurityHeader` stays stubbed: it pulls the security overview query in,
 * and this file is not about the header.
 *
 * ## fireEvent vs userEvent
 *
 * `fireEvent.changeText` fills the fields. The screen's logic depends on the
 * value a field ends up holding, not on the keystrokes that got it there, and
 * `userEvent.type` costs a per-character render for no extra coverage.
 *
 * `userEvent.press` drives the submit button, because press dispatch is
 * exactly where the difference matters: `userEvent` refuses to press a
 * disabled element, so "a second press while in flight does nothing" is a
 * real assertion rather than a restatement of the mock.
 */
const mockGraphqlRequest = jest.fn();
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api'),
  graphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
}));

jest.mock('@/modules/security', () => ({
  ...jest.requireActual('@/modules/security'),
  SecurityHeader: () => null,
}));

import type { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/services/api-error';
import ChangePasswordScreen from '@/app/security/password';
import { createTestQueryClient, fireEvent, renderScreen, userEvent, waitFor } from '../test-utils';

/** Long enough to clear MIN_PASSWORD_LENGTH, and distinct from each other. */
const CURRENT = 'oldpassword1';
const NEXT = 'newpassword2';

const SUCCESS_BANNER = 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว อุปกรณ์เครื่องอื่นถูกออกจากระบบทั้งหมด';

type Screen = Awaited<ReturnType<typeof renderScreen>>;

/**
 * Fills all three boxes. Defaults are the happy path; override to break one.
 *
 * Every `fireEvent` is awaited. In RNTL v14 it returns a promise, and firing
 * the next one before the previous act scope closes gets you "overlapping
 * act() calls" — which does not fail the line that caused it. It fails the
 * assertion afterwards, and then the *next test in the file*, which is the
 * expensive part: that test then passes when run alone.
 */
async function fillForm(
  view: Screen,
  values: { current?: string; next?: string; confirm?: string } = {},
) {
  const { current = CURRENT, next = NEXT, confirm = next } = values;
  await fireEvent.changeText(view.getByTestId('password-current'), current);
  await fireEvent.changeText(view.getByTestId('password-new'), next);
  await fireEvent.changeText(view.getByTestId('password-confirm'), confirm);
}

/** A promise the test resolves by hand, to hold the mutation in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let queryClient: QueryClient;

beforeEach(() => {
  // `clearAllMocks` clears calls but keeps implementations, and every test
  // below sets its own — so the implementation is reset explicitly rather
  // than inherited from whichever test ran last.
  jest.clearAllMocks();
  mockGraphqlRequest.mockReset();
  mockGraphqlRequest.mockResolvedValue({ changePassword: true });
  queryClient = createTestQueryClient();
  /*
   * The mutation garbage-collection window has to be closed by hand, and it
   * is the one thing this batch cost that was not the screen's fault.
   * `createTestQueryClient` sets `gcTime: 0` on `queries` only; an unobserved
   * mutation still schedules its removal on the default **five-minute**
   * timer, and that timer keeps the Node process alive. The symptom is not a
   * failing test — all fifteen pass — it is "Jest did not exit one second
   * after the test run has completed" and a run that then sits there for five
   * minutes. Every screen test written so far has been read-only, which is
   * why nothing has hit this before; the first screen test that submits a
   * form anywhere in this suite will hit it again.
   */
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    mutations: { retry: false, gcTime: 0 },
  });
});

afterEach(() => {
  queryClient.clear();
});

/** Every test renders the same screen; only the transport mock differs. */
const renderPasswordScreen = () =>
  renderScreen(<ChangePasswordScreen />, { queryClient });

describe('ChangePasswordScreen', () => {
  it('renders all three fields and the submit action', async () => {
    const view = await renderPasswordScreen();

    expect(view.getByTestId('password-current')).toBeOnTheScreen();
    expect(view.getByTestId('password-new')).toBeOnTheScreen();
    expect(view.getByTestId('password-confirm')).toBeOnTheScreen();
    expect(view.getByTestId('password-submit')).toBeOnTheScreen();
  });

  /*
   * Stated before the attempt, not after it. A minimum length discovered only
   * by failing is a round trip the user pays for with a rejected form, and
   * `MIN_PASSWORD_LENGTH` matches the gateway's floor — so the number here is
   * a contract, not decoration.
   */
  it('states the length floor and the sign-out consequence up front', async () => {
    const view = await renderPasswordScreen();

    expect(view.getByText(/ตั้งรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร/)).toBeOnTheScreen();
    expect(view.getByText(/อุปกรณ์เครื่องอื่นจะถูกออกจากระบบ/)).toBeOnTheScreen();
  });

  it('renders no banner before anything has been submitted', async () => {
    const view = await renderPasswordScreen();

    expect(view.queryByText(/เปลี่ยนรหัสผ่านเรียบร้อยแล้ว/)).toBeNull();
    expect(view.queryByText(/เปลี่ยนรหัสผ่านไม่สำเร็จ/)).toBeNull();
  });

  describe('validation', () => {
    /*
     * The whole point of the inline errors: three identical-looking boxes,
     * and the user has to be told which one. All three messages at once, and
     * nothing on the wire — an empty form must not cost a round trip.
     */
    it('names every empty field and sends nothing', async () => {
      const view = await renderPasswordScreen();

      await userEvent.press(view.getByTestId('password-submit'));

      expect(view.getByText('กรุณากรอกรหัสผ่านปัจจุบัน')).toBeOnTheScreen();
      expect(view.getByText('กรุณากรอกรหัสผ่านใหม่')).toBeOnTheScreen();
      expect(view.getByText('กรุณายืนยันรหัสผ่านใหม่')).toBeOnTheScreen();
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('rejects a new password under the length floor', async () => {
      const view = await renderPasswordScreen();
      await fillForm(view, { next: 'short7c' });

      await userEvent.press(view.getByTestId('password-submit'));

      expect(view.getByText('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')).toBeOnTheScreen();
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    // Not cosmetic: the gateway revokes every other session on a change, so a
    // no-op "change" signs the user's other devices out for nothing.
    it('rejects a new password identical to the current one', async () => {
      const view = await renderPasswordScreen();
      await fillForm(view, { next: CURRENT });

      await userEvent.press(view.getByTestId('password-submit'));

      expect(view.getByText('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม')).toBeOnTheScreen();
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    // The mismatch has to be caught here or it is caught by the user being
    // locked out of an account whose password they typed wrong twice.
    it('rejects a confirmation that does not match, and says so on the confirm field', async () => {
      const view = await renderPasswordScreen();
      await fillForm(view, { confirm: `${NEXT}x` });

      await userEvent.press(view.getByTestId('password-submit'));

      expect(view.getByText('ยืนยันรหัสผ่านไม่ตรงกัน')).toBeOnTheScreen();
      // The new-password field is innocent here; blaming it too would send
      // the user to fix the box that is already right.
      expect(view.queryByText('กรุณากรอกรหัสผ่านใหม่')).toBeNull();
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    // Without this the error outlives the mistake: the user fixes the box and
    // is still looking at red text telling them it is wrong.
    it('clears a field error as soon as that field is edited', async () => {
      const view = await renderPasswordScreen();
      await userEvent.press(view.getByTestId('password-submit'));
      expect(view.getByText('กรุณากรอกรหัสผ่านปัจจุบัน')).toBeOnTheScreen();

      await fireEvent.changeText(view.getByTestId('password-current'), CURRENT);

      await waitFor(() => {
        expect(view.queryByText('กรุณากรอกรหัสผ่านปัจจุบัน')).toBeNull();
      });
      // Only that field's error. Editing one box does not absolve the others.
      expect(view.getByText('กรุณากรอกรหัสผ่านใหม่')).toBeOnTheScreen();
    });
  });

  describe('submission', () => {
    /*
     * The payload-level assertion, and the reason this file mocks the
     * transport rather than the hook. `toEqual` on the whole variables object
     * fails if a field is added, renamed, or dropped — and the confirmation
     * box, which exists purely for the user, must never reach the server.
     */
    it('sends exactly the current and new password, and nothing else', async () => {
      const view = await renderPasswordScreen();
      await fillForm(view);

      await userEvent.press(view.getByTestId('password-submit'));

      await waitFor(() => expect(mockGraphqlRequest).toHaveBeenCalledTimes(1));
      const variables = mockGraphqlRequest.mock.calls[0][1];
      expect(variables).toEqual({
        input: { currentPassword: CURRENT, newPassword: NEXT },
      });
      // Stated as a negative as well: a positive `toEqual` on a nested object
      // is easy to loosen by accident, and these two are the ones that would
      // hurt — the confirmation is redundant, and a plaintext echo of the new
      // password under a second key is a leak nobody would notice.
      for (const forbidden of ['confirm', 'confirmPassword', 'password']) {
        expect(variables.input).not.toHaveProperty(forbidden);
      }
    });

    it('reports success and empties all three boxes', async () => {
      const view = await renderPasswordScreen();
      await fillForm(view);

      await userEvent.press(view.getByTestId('password-submit'));

      await waitFor(() => {
        expect(view.getByText(SUCCESS_BANNER)).toBeOnTheScreen();
      });
      // Clearing matters beyond tidiness: the boxes hold the old password and
      // the new one in plaintext, and the screen does not navigate away.
      expect(view.getByTestId('password-current').props.value).toBe('');
      expect(view.getByTestId('password-new').props.value).toBe('');
      expect(view.getByTestId('password-confirm').props.value).toBe('');
    });

    /*
     * Two password changes racing is one of them authenticating against a
     * password that no longer exists. The disabled assertion is written as a
     * pair — enabled before, disabled during — because `toBeDisabled()` is
     * only meaningful here if it can also come out false on this element.
     */
    it('blocks a second submit while the first is in flight', async () => {
      const pending = deferred<{ changePassword: boolean }>();
      mockGraphqlRequest.mockReturnValue(pending.promise);

      const view = await renderPasswordScreen();
      expect(view.getByTestId('password-submit')).toBeEnabled();
      await fillForm(view);

      await userEvent.press(view.getByTestId('password-submit'));

      await waitFor(() => {
        expect(view.getByTestId('password-submit')).toBeDisabled();
      });
      // The guard, not the styling: a press that lands anyway would be a
      // second mutation against a credential the first one is rotating.
      await userEvent.press(view.getByTestId('password-submit'));
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);

      pending.resolve({ changePassword: true });
      await waitFor(() => {
        expect(view.getByText(SUCCESS_BANNER)).toBeOnTheScreen();
      });
    });
  });

  describe('failure', () => {
    /*
     * FINDING, asserted as it behaves today rather than as the screen's own
     * comment describes it.
     *
     * `password.tsx` routes `view.field === 'password'` onto the current-
     * password field, on the stated reasoning that "the gateway answers a
     * wrong current password with a 401". But `formatAuthError` maps
     * UNAUTHENTICATED to `field: 'both'` (auth/lib/errors.ts), and nothing it
     * can return is ever `'password'` in this context. So the branch is
     * unreachable, the error lands in the banner, and the copy it lands with
     * is the login screen's — it names the phone number, which this screen
     * does not have a box for.
     *
     * This test pins where the message actually surfaces. It is deliberately
     * not asserting the intended behaviour: that would be a red test for a
     * production change this batch is not allowed to make.
     */
    it('surfaces a rejected current password where the user can read it', async () => {
      mockGraphqlRequest.mockRejectedValue(
        new ApiError('[UNAUTHENTICATED] invalid password', {
          code: 'UNAUTHENTICATED',
          httpStatus: 401,
        }),
      );

      const view = await renderPasswordScreen();
      await fillForm(view);

      await userEvent.press(view.getByTestId('password-submit'));

      await waitFor(() => {
        expect(view.getByText('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง')).toBeOnTheScreen();
      });
      // Nothing succeeded, so nothing may claim it did — and the typed values
      // stay put so the user can correct one box rather than all three.
      expect(view.queryByText(SUCCESS_BANNER)).toBeNull();
      expect(view.getByTestId('password-new').props.value).toBe(NEXT);
    });

    // The throttle countdown is the one failure whose message carries a
    // number, and a wrong number here is worse than no number.
    it('shows the throttle wait the server asked for', async () => {
      mockGraphqlRequest.mockRejectedValue(
        new ApiError('[TOO_MANY_REQUESTS] slow down', {
          code: 'TOO_MANY_REQUESTS',
          httpStatus: 429,
          retryAfterSec: 90,
        }),
      );

      const view = await renderPasswordScreen();
      await fillForm(view);

      await userEvent.press(view.getByTestId('password-submit'));

      await waitFor(() => {
        expect(view.getByText('ลองเข้าระบบบ่อยเกินไป กรุณารออีก 2 นาที')).toBeOnTheScreen();
      });
    });

    // An unrecognised failure must still say something specific to *this*
    // screen — the fallback the screen passes in, not the module's generic.
    it('falls back to the screen-specific message for an unrecognised failure', async () => {
      mockGraphqlRequest.mockRejectedValue(new Error('boom'));

      const view = await renderPasswordScreen();
      await fillForm(view);

      await userEvent.press(view.getByTestId('password-submit'));

      await waitFor(() => {
        expect(
          view.getByText('เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่'),
        ).toBeOnTheScreen();
      });
      expect(view.queryByText('เกิดข้อผิดพลาด กรุณาลองใหม่')).toBeNull();
    });

    /*
     * The banner is cleared at the top of every submit. Without that, a
     * failure banner outlives the attempt that produced it and sits above a
     * form the user has since corrected — reading as a fresh failure of the
     * submit that was actually blocked by validation.
     */
    it('drops the previous banner when the next attempt is made', async () => {
      mockGraphqlRequest.mockRejectedValue(new Error('boom'));

      const view = await renderPasswordScreen();
      await fillForm(view);
      await userEvent.press(view.getByTestId('password-submit'));
      await waitFor(() => {
        expect(view.getByText('เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่')).toBeOnTheScreen();
      });

      await fireEvent.changeText(view.getByTestId('password-new'), '');
      await userEvent.press(view.getByTestId('password-submit'));

      await waitFor(() => {
        expect(view.queryByText('เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่')).toBeNull();
      });
      expect(view.getByText('กรุณากรอกรหัสผ่านใหม่')).toBeOnTheScreen();
    });
  });
});
