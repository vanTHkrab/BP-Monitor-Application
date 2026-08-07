/**
 * The passkey list and the three mutations that change it.
 *
 * Everything worth asserting here is about *invalidation*, because that is
 * the only thing these hooks add on top of `security-api`. The hub screen
 * shows a passkey count that comes from a different query (`security-overview`)
 * than the list (`passkeys`), so a mutation that refreshes one and not the
 * other leaves "3 passkeys" one tap away from a list of two — the exact kind
 * of disagreement the module docstring says it is avoiding.
 *
 * Invalidation is asserted through `getQueryState().isInvalidated` rather than
 * a spy on `invalidateQueries`. The spy proves a call happened with some key;
 * the cache state proves the entry the *other screen* reads was actually
 * marked stale, which is the thing that breaks when someone renames a key.
 *
 * Note the asymmetry in the block for `useRenamePasskey`: the file header says
 * "Every mutation invalidates the overview too" and rename does not. The
 * behaviour is defensible — renaming changes no count — but the comment and
 * the code disagree, and the test below pins the code. See the report.
 */
const mockFetchPasskeys = jest.fn();
const mockRegisterPasskey = jest.fn();
const mockRenamePasskey = jest.fn();
const mockDeletePasskey = jest.fn();
jest.mock('../services/security-api', () => ({
  fetchPasskeys: (...args: unknown[]) => mockFetchPasskeys(...args),
  registerPasskey: (...args: unknown[]) => mockRegisterPasskey(...args),
  renamePasskey: (...args: unknown[]) => mockRenamePasskey(...args),
  deletePasskey: (...args: unknown[]) => mockDeletePasskey(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import type { Passkey } from '../types';
import {
  useDeletePasskey,
  usePasskeys,
  useRegisterPasskey,
  useRenamePasskey,
} from './use-passkeys';

const passkey = (id: string, over: Partial<Passkey> = {}): Passkey => ({
  id,
  name: 'Pixel 8',
  backedUp: true,
  deviceType: 'multiDevice',
  createdAt: new Date('2026-01-15T10:00:00.000Z'),
  ...over,
});

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const stateOf = (key: string) => client.getQueryState([key]);

/** Both entries present and fresh, as they are when the hub has been opened. */
function seedBothScreens(): void {
  client.setQueryData(['passkeys'], [passkey('pk-1')]);
  client.setQueryData(['security-overview'], { passkeyCount: 1 });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchPasskeys.mockReset();
  mockRegisterPasskey.mockReset();
  mockRenamePasskey.mockReset();
  mockDeletePasskey.mockReset();

  mockFetchPasskeys.mockResolvedValue([]);
  mockRegisterPasskey.mockResolvedValue(passkey('pk-2'));
  mockRenamePasskey.mockResolvedValue(passkey('pk-1', { name: 'Work phone' }));
  mockDeletePasskey.mockResolvedValue(undefined);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('usePasskeys', () => {
  it('files the list under the key the three mutations invalidate', async () => {
    mockFetchPasskeys.mockResolvedValue([passkey('pk-1')]);

    const view = await renderHook(() => usePasskeys(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));

    expect(client.getQueryData(['passkeys'])).toEqual([passkey('pk-1')]);
    expect(view.result.current.passkeys).toEqual([passkey('pk-1')]);
  });

  it('gives the screen an empty list rather than undefined before the first load', async () => {
    // The queryFn is held open deliberately. With a `mockResolvedValue` the
    // query can settle before the assertion runs — this failed once under the
    // full parallel suite at `--randomize --seed=20260808`, on the
    // `isLoading` half, having passed every single-file run. "Still loading"
    // has to be made true, not hoped for.
    mockFetchPasskeys.mockImplementation(() => new Promise(() => {}));

    const view = await renderHook(() => usePasskeys(), { wrapper });

    // The screen maps over this directly; `undefined` is a crash, not a
    // spinner.
    expect(view.result.current.passkeys).toEqual([]);
    expect(view.result.current.isLoading).toBe(true);
  });

  it('surfaces the transport error unwrapped', async () => {
    const cause = new ApiError('[UNAUTHENTICATED] no', { code: 'UNAUTHENTICATED' });
    mockFetchPasskeys.mockRejectedValue(cause);

    const view = await renderHook(() => usePasskeys(), { wrapper });
    await waitFor(() => expect(view.result.current.error).not.toBeNull());

    // The screen distinguishes "your session ended" from "this server has no
    // passkey support" off `code`; a wrapped error collapses both into
    // "something went wrong".
    expect(view.result.current.error).toBe(cause);
  });
});

describe('useRegisterPasskey', () => {
  it('passes the label through, and omits it when the user gave none', async () => {
    const view = await renderHook(() => useRegisterPasskey(), { wrapper });

    await act(async () => {
      await view.result.current.registerPasskey('Work phone');
    });
    expect(mockRegisterPasskey).toHaveBeenCalledWith('Work phone');

    await act(async () => {
      await view.result.current.registerPasskey(undefined);
    });
    // `undefined`, not `''`: the service falls back to a device label only for
    // a falsy name, and an empty string would be stored as the passkey's name.
    //
    // The `undefined` is written out because `mutateAsync` types its variables
    // argument as required even when the mutation's own parameter is optional
    // — `registerPasskey()` is a type error, and the screen has to spell it
    // out the same way.
    expect(mockRegisterPasskey).toHaveBeenLastCalledWith(undefined);
  });

  it('refreshes both the list and the hub count', async () => {
    seedBothScreens();
    const view = await renderHook(() => useRegisterPasskey(), { wrapper });

    await act(async () => {
      await view.result.current.registerPasskey('Work phone');
    });

    expect(stateOf('passkeys')?.isInvalidated).toBe(true);
    expect(stateOf('security-overview')?.isInvalidated).toBe(true);
  });

  it('surfaces the failure with its code and lets the screen reset it', async () => {
    const cause = new ApiError('[CONFLICT] already registered', { code: 'CONFLICT' });
    mockRegisterPasskey.mockRejectedValue(cause);

    const view = await renderHook(() => useRegisterPasskey(), { wrapper });
    await act(async () => {
      await view.result.current.registerPasskey(undefined).catch(() => {});
    });

    // `waitFor`: `mutateAsync`'s rejection settles one notify tick before the
    // hook re-renders carrying `mutation.error`.
    await waitFor(() => expect(view.result.current.error).toBe(cause));

    await act(async () => {
      view.result.current.reset();
    });
    // `waitFor` on this side too. A bare assertion here passed on a single-file
    // run and failed once under the full parallel suite: `reset()` schedules
    // the clear through the same notify manager, and whether the re-render has
    // landed by the next line depends on how loaded the worker is.
    await waitFor(() => expect(view.result.current.error).toBeNull());
  });

  it('refreshes nothing when registration fails', async () => {
    seedBothScreens();
    mockRegisterPasskey.mockRejectedValue(new Error('User cancelled'));

    const view = await renderHook(() => useRegisterPasskey(), { wrapper });
    await act(async () => {
      await view.result.current.registerPasskey(undefined).catch(() => {});
    });

    // A refetch after a failed ceremony costs a request and, worse, makes a
    // cancelled registration look like it did something.
    expect(stateOf('passkeys')?.isInvalidated).toBe(false);
    expect(stateOf('security-overview')?.isInvalidated).toBe(false);
  });
});

describe('useRenamePasskey', () => {
  it('sends the id and the new name as one input', async () => {
    const view = await renderHook(() => useRenamePasskey(), { wrapper });

    await act(async () => {
      await view.result.current.renamePasskey({ id: 'pk-1', name: 'Work phone' });
    });

    expect(mockRenamePasskey).toHaveBeenCalledWith('pk-1', 'Work phone');
  });

  it('refreshes the list but deliberately not the hub count', async () => {
    seedBothScreens();
    const view = await renderHook(() => useRenamePasskey(), { wrapper });

    await act(async () => {
      await view.result.current.renamePasskey({ id: 'pk-1', name: 'Work phone' });
    });

    expect(stateOf('passkeys')?.isInvalidated).toBe(true);
    // The negative half. A rename changes no count, so refetching the hub
    // would be a request for nothing — but this contradicts the module
    // docstring's "every mutation invalidates the overview too", and the code
    // is what is pinned here. See the report.
    expect(stateOf('security-overview')?.isInvalidated).toBe(false);
  });

  it('rejects with the transport error, since it exposes no error state', async () => {
    const cause = new ApiError('[BAD_USER_INPUT] ชื่อยาวเกินไป', { code: 'BAD_USER_INPUT' });
    mockRenamePasskey.mockRejectedValue(cause);

    const view = await renderHook(() => useRenamePasskey(), { wrapper });
    let thrown: unknown = null;
    await act(async () => {
      try {
        await view.result.current.renamePasskey({ id: 'pk-1', name: 'x'.repeat(500) });
      } catch (error) {
        thrown = error;
      }
    });

    // This hook returns no `error`, so the rejection is the screen's only
    // signal and has to arrive intact.
    expect(thrown).toBe(cause);
    expect(view.result.current.isPending).toBe(false);
  });
});

describe('useDeletePasskey', () => {
  it('sends the id alone', async () => {
    const view = await renderHook(() => useDeletePasskey(), { wrapper });

    await act(async () => {
      await view.result.current.deletePasskey('pk-1');
    });

    expect(mockDeletePasskey).toHaveBeenCalledWith('pk-1');
  });

  it('refreshes both the list and the hub count', async () => {
    seedBothScreens();
    const view = await renderHook(() => useDeletePasskey(), { wrapper });

    await act(async () => {
      await view.result.current.deletePasskey('pk-1');
    });

    // Removing the last passkey and leaving the hub saying "1 passkey" tells
    // the user their account is protected when it no longer is.
    expect(stateOf('passkeys')?.isInvalidated).toBe(true);
    expect(stateOf('security-overview')?.isInvalidated).toBe(true);
  });

  it('surfaces a refused delete with its code and refreshes nothing', async () => {
    seedBothScreens();
    const cause = new ApiError('[FORBIDDEN] not yours', { code: 'FORBIDDEN', httpStatus: 403 });
    mockDeletePasskey.mockRejectedValue(cause);

    const view = await renderHook(() => useDeletePasskey(), { wrapper });
    await act(async () => {
      await view.result.current.deletePasskey('pk-1').catch(() => {});
    });

    await waitFor(() => expect(view.result.current.error).toBe(cause));
    // Invalidating here would refetch a list that still contains the row and
    // make the failed delete look like a rendering glitch.
    expect(stateOf('passkeys')?.isInvalidated).toBe(false);
    expect(stateOf('security-overview')?.isInvalidated).toBe(false);
  });
});
