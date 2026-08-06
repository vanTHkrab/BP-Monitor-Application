/**
 * The invite field after A-005 — one input that is a phone *or* an email.
 *
 * These render the whole path (form → `useInvitePatient` → `caregivers-api`)
 * with only the transport mocked, because the bug this guards against lives
 * between the layers: the form used to format and the API layer used to strip
 * to digits, and either one applied to an address silently turns an email
 * invite into a phone lookup that cannot succeed. Asserting on the GraphQL
 * variables is the only place that is visible.
 */
// Reached through `use-font-scale` → the preferences store, same as the
// decision card's test next door.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

jest.mock('@/services/api', () => ({ graphqlRequest: jest.fn() }));

import { ApiError } from '@/services/api-error';
import { graphqlRequest } from '@/services/api';
import { InviteForm } from './invite-form';
import { fireEvent, renderScreen, waitFor } from '../../../../__test__/test-utils';

const mockRequest = graphqlRequest as jest.MockedFunction<typeof graphqlRequest>;

const linkPayload = {
  caregiverId: 'cg-1',
  patientId: 'pt-1',
  relationship: 'child',
  caregiverName: 'สมหญิง ใจงาม',
  caregiverPhone: '0898765432',
  patientName: 'สมชาย ใจดี',
  patientPhone: '0812345678',
  status: 'pending',
  respondedAt: null,
  permission: 'full',
};

/** The variables the mutation was actually called with. */
const sentVariables = () =>
  (mockRequest.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;

const typeAndSend = async (text: string) => {
  const view = await renderScreen(<InviteForm />);
  await fireEvent.changeText(view.getByTestId('invite-contact'), text);
  await fireEvent.press(view.getByTestId('invite-submit'));
  return view;
};

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ addCaregiverPatient: linkPayload } as never);
});

describe('InviteForm — what reaches the wire', () => {
  it('sends an email untouched apart from trim and lowercase', async () => {
    await typeAndSend('  Some.One+bp@Example.COM  ');

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(sentVariables().patientContact).toBe('some.one+bp@example.com');
  });

  it('does not reduce an address containing digits to those digits', async () => {
    await typeAndSend('user081234@example.com');

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(sentVariables().patientContact).toBe('user081234@example.com');
  });

  // Regression: the pre-A-005 behaviour, which the "@" branch must not lose.
  it('still strips a formatted phone number to digits', async () => {
    await typeAndSend('0812345678');

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(sentVariables().patientContact).toBe('0812345678');
  });

  it('sends patientContact, not the retired patientPhone argument', async () => {
    await typeAndSend('0812345678');

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(sentVariables()).not.toHaveProperty('patientPhone');
  });
});

describe('InviteForm — the branch flips as the user types', () => {
  it('formats while it is a phone and un-formats the moment an "@" appears', async () => {
    const view = await renderScreen(<InviteForm />);
    const field = view.getByTestId('invite-contact');

    await fireEvent.changeText(field, '0812345678');
    expect(field.props.value).toBe('081-234-5678');

    // The keystroke the trap is about: appending "@" to the formatted value.
    await fireEvent.changeText(field, '081-234-5678@');
    expect(field.props.value).toBe('0812345678@');

    await fireEvent.changeText(field, '0812345678@example.com');
    await fireEvent.press(view.getByTestId('invite-submit'));

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(sentVariables().patientContact).toBe('0812345678@example.com');
  });
});

describe('InviteForm — validation stays looser than the gateway', () => {
  it('blocks a short phone number without calling the API', async () => {
    const view = await typeAndSend('081-23');

    expect(view.getByText('กรุณากรอกเบอร์โทรศัพท์ของผู้ป่วยให้ครบ')).toBeOnTheScreen();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('blocks an "@" with nothing after it without calling the API', async () => {
    const view = await typeAndSend('someone@');

    expect(view.getByText('กรุณากรอกอีเมลของผู้ป่วยให้ครบ')).toBeOnTheScreen();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('lets an address the server may still reject through', async () => {
    await typeAndSend('a@b');

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(sentVariables().patientContact).toBe('a@b');
  });
});

describe('InviteForm — the banner', () => {
  it('names the patient and the wait on success', async () => {
    const view = await typeAndSend('0812345678');

    expect(
      await view.findByText(
        'ส่งคำเชิญถึงคุณสมชาย ใจดี แล้ว จะเห็นข้อมูลได้เมื่อผู้ป่วยกดอนุญาต',
      ),
    ).toBeOnTheScreen();
  });

  /*
   * The gateway raises both of these on the same error code and distinguishes
   * them only by the message. Reaching the banner is what lets it name back
   * the kind that was actually sent; mapping the code to fixed local copy
   * would tell half of these users the wrong identifier is missing.
   *
   * Matched as a substring rather than by equality, deliberately. The real
   * `ApiError` message is `"<OperationName> failed: [CODE] <thai>"` and
   * `formatErrorMessage`'s `stripCode` only removes a `[CODE] ` that is at
   * the *start* of the string, so today the English operation prefix rides
   * along into the banner. That is a pre-existing leak shared by all six
   * `formatErrorMessage` call sites, not something A-005 introduced, and
   * fixing it is a separate change — see the handoff note. A substring
   * assertion is the shape that stays true either way.
   */
  it.each([
    ['someone@example.com', 'ไม่พบผู้ใช้จากอีเมลนี้'],
    ['0812345678', 'ไม่พบผู้ใช้จากเบอร์โทรศัพท์นี้'],
  ])('surfaces the server not-found message for %s', async (typed, message) => {
    mockRequest.mockRejectedValue(
      new ApiError(`AddCaregiverPatient failed: [NOT_FOUND] ${message}`, {
        code: 'NOT_FOUND',
        httpStatus: 404,
      }),
    );

    const view = await typeAndSend(typed);

    expect(await view.findByText(new RegExp(message))).toBeOnTheScreen();
  });

  it('falls back to Thai copy rather than leaking an English server message', async () => {
    mockRequest.mockRejectedValue(
      new ApiError('AddCaregiverPatient failed: Internal server error', {
        httpStatus: 500,
      }),
    );

    const view = await typeAndSend('0812345678');

    expect(
      await view.findByText('ส่งคำเชิญไม่สำเร็จ กรุณาลองใหม่'),
    ).toBeOnTheScreen();
  });
});
