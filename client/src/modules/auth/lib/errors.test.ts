import { ApiError } from '@/services/api-error';
import { formatAuthError } from './errors';

const apiError = (
  message: string,
  opts: { code?: string; httpStatus?: number; retryAfterSec?: number } = {},
) => new ApiError(message, opts);

describe('formatAuthError', () => {
  describe('throttling', () => {
    it('maps the TOO_MANY_REQUESTS code Better Auth added', () => {
      // The old gateway flattened this to BAD_REQUEST. An unmapped code here
      // renders a correct server message as a generic failure.
      const view = formatAuthError(
        apiError('too many', { code: 'TOO_MANY_REQUESTS', retryAfterSec: 30 }),
      );

      expect(view.message).toContain('30 วินาที');
      expect(view.retryAfterSec).toBe(30);
    });

    it('still maps a bare 429 with no code', () => {
      const view = formatAuthError(apiError('slow down', { httpStatus: 429, retryAfterSec: 45 }));
      expect(view.message).toContain('45 วินาที');
    });

    it('rounds a long wait up to whole minutes', () => {
      const view = formatAuthError(apiError('x', { httpStatus: 429, retryAfterSec: 90 }));
      expect(view.message).toContain('2 นาที');
    });

    it('drops the countdown when the server did not say how long', () => {
      const view = formatAuthError(apiError('x', { httpStatus: 429 }));
      expect(view.retryAfterSec).toBeNull();
      expect(view.message).toContain('รอสักครู่');
    });
  });

  describe('CONFLICT', () => {
    it('lands a duplicate email on the email field', () => {
      const view = formatAuthError(apiError('อีเมลนี้ถูกใช้งานแล้ว', { code: 'CONFLICT' }), {
        context: 'register',
      });

      expect(view.field).toBe('email');
      expect(view.message).toBe('อีเมลนี้ถูกใช้งานแล้ว');
    });

    it('lands a duplicate phone on the phone field', () => {
      const view = formatAuthError(apiError('เบอร์นี้ถูกใช้งานแล้ว', { code: 'CONFLICT' }), {
        context: 'register',
      });

      expect(view.field).toBe('phone');
    });

    it('defaults an unattributable conflict to phone during register', () => {
      // Both routes throw the same code; phone is the field every account
      // must have, so an ambiguous message is likelier to be about it.
      const view = formatAuthError(apiError('duplicate', { code: 'CONFLICT' }), {
        context: 'register',
      });

      expect(view.field).toBe('phone');
    });

    it('attaches to no field outside register', () => {
      const view = formatAuthError(apiError('dup', { code: 'CONFLICT' }), { context: 'login' });
      expect(view.field).toBeNull();
    });
  });

  describe('credentials and account state', () => {
    it('marks both fields on UNAUTHENTICATED without naming which was wrong', () => {
      const view = formatAuthError(apiError('bad creds', { code: 'UNAUTHENTICATED' }));

      expect(view.field).toBe('both');
      expect(view.message).toBe('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง');
    });

    it('explains a suspended account on FORBIDDEN', () => {
      const view = formatAuthError(apiError('banned', { code: 'FORBIDDEN' }));
      expect(view.message).toContain('ถูกระงับ');
    });
  });

  describe('never leaking English', () => {
    it('replaces an English BAD_USER_INPUT message', () => {
      const view = formatAuthError(apiError('phone must match /^0[0-9]{9}$/', {
        code: 'BAD_USER_INPUT',
      }));

      expect(view.message).not.toContain('must match');
      expect(view.message).toBe('ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
    });

    it('passes through a Thai BAD_USER_INPUT message from class-validator', () => {
      const view = formatAuthError(
        apiError('[BAD_USER_INPUT] รหัสผ่านสั้นเกินไป', { code: 'BAD_USER_INPUT' }),
      );

      expect(view.message).toBe('รหัสผ่านสั้นเกินไป');
    });

    it('replaces an English message under an unrecognised code', () => {
      const view = formatAuthError(apiError('Internal server error', { code: 'WHAT_IS_THIS' }), {
        fallback: 'ลองใหม่อีกครั้ง',
      });

      expect(view.message).toBe('ลองใหม่อีกครั้ง');
    });

    it('surfaces a Thai message under an unrecognised code', () => {
      const view = formatAuthError(
        apiError('[TEAPOT] ระบบปิดปรับปรุงชั่วคราว', { code: 'TEAPOT' }),
      );

      expect(view.message).toBe('ระบบปิดปรับปรุงชั่วคราว');
    });
  });

  describe('connectivity', () => {
    it('distinguishes a timeout from an unreachable server', () => {
      const timeout = formatAuthError(apiError('t', { code: 'NETWORK_TIMEOUT' }));
      const failed = formatAuthError(apiError('f', { code: 'NETWORK_FAILED' }));

      expect(timeout.message).toContain('ภายในเวลาที่กำหนด');
      expect(failed.message).toContain('ตรวจสอบอินเทอร์เน็ต');
      expect(timeout.message).not.toBe(failed.message);
    });
  });

  it('falls back for a non-Error throw', () => {
    expect(formatAuthError(undefined).message).toBe('เกิดข้อผิดพลาด กรุณาลองใหม่');
  });
});
