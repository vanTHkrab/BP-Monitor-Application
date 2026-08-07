/**
 * @jest-environment node
 *
 * Endpoint resolution. Both inputs have to be mocked rather than set:
 *
 *   - `env.apiUrl` reads `process.env.EXPO_PUBLIC_API_URL`, which Expo's Babel
 *     preset inlines as a *literal* at transform time. Assigning it in a test
 *     changes nothing, so `@/config` is mocked behind a mutable holder.
 *   - `Constants` varies by runtime (Expo Go, dev client, release), which is
 *     what the six-way fallback in `getExpoHostUri` exists for.
 */
const mockEnv: { apiUrl: string | undefined } = { apiUrl: undefined };

// Getters, not plain properties. `jest.mock` factories are hoisted above the
// imports, and the import of './endpoint' below requires '@/config'
// immediately — at which point `mockEnv` has not been initialised yet and a
// direct `{ env: mockEnv }` captures `undefined` forever.
jest.mock('@/config', () => ({
  get env() {
    return mockEnv;
  },
}));

type ConstantsShape = {
  expoConfig?: { hostUri?: string } | null;
  expoGoConfig?: { debuggerHost?: string; hostUri?: string };
  manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  manifest?: { debuggerHost?: string };
  platform?: { hostUri?: string };
};

const mockConstants: ConstantsShape = {};
jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() {
    return mockConstants;
  },
}));

import { getGraphqlEndpoint, resolveGraphqlEndpoint } from './endpoint';

beforeEach(() => {
  mockEnv.apiUrl = undefined;
  for (const key of Object.keys(mockConstants)) {
    delete mockConstants[key as keyof ConstantsShape];
  }
});

describe('resolveGraphqlEndpoint', () => {
  it('returns EXPO_PUBLIC_API_URL verbatim when it is set', () => {
    // Verbatim matters: the env var carries the whole URL including the path,
    // so appending or rewriting it here would break a non-/graphql mount.
    mockEnv.apiUrl = 'https://api.example.test/v2/graphql';
    mockConstants.expoConfig = { hostUri: '192.168.1.5:8081' };

    expect(resolveGraphqlEndpoint()).toBe('https://api.example.test/v2/graphql');
  });

  it('derives the LAN endpoint from the Expo host on port 3000', () => {
    mockConstants.expoConfig = { hostUri: '192.168.1.5:8081' };

    expect(resolveGraphqlEndpoint()).toBe('http://192.168.1.5:3000/graphql');
  });

  it('reads the host from expoConfig first', () => {
    mockConstants.expoConfig = { hostUri: '10.0.0.1:8081' };
    mockConstants.expoGoConfig = { debuggerHost: '10.0.0.2:8081' };

    expect(resolveGraphqlEndpoint()).toBe('http://10.0.0.1:3000/graphql');
  });

  it.each([
    ['expoGoConfig.debuggerHost', { expoGoConfig: { debuggerHost: '10.0.0.2:8081' } }, '10.0.0.2'],
    ['expoGoConfig.hostUri', { expoGoConfig: { hostUri: '10.0.0.3:8081' } }, '10.0.0.3'],
    [
      'manifest2.extra.expoClient.hostUri',
      { manifest2: { extra: { expoClient: { hostUri: '10.0.0.4:8081' } } } },
      '10.0.0.4',
    ],
    ['manifest.debuggerHost', { manifest: { debuggerHost: '10.0.0.5:8081' } }, '10.0.0.5'],
    ['platform.hostUri', { platform: { hostUri: '10.0.0.6:8081' } }, '10.0.0.6'],
  ])('falls back to %s', (_label, shape, host) => {
    Object.assign(mockConstants, shape);

    expect(resolveGraphqlEndpoint()).toBe(`http://${host}:3000/graphql`);
  });

  it('accepts a bare host with no port', () => {
    mockConstants.expoConfig = { hostUri: 'devbox.local' };

    expect(resolveGraphqlEndpoint()).toBe('http://devbox.local:3000/graphql');
  });

  it.each(['127.0.0.1:8081', 'localhost:8081', '0.0.0.0:8081', '::1'])(
    'refuses the loopback host %s rather than pointing the phone at itself',
    (hostUri) => {
      // A device resolving "localhost" hits its own loopback and every request
      // fails with an unhelpful network error, which is worse than a clear throw.
      mockConstants.expoConfig = { hostUri };

      expect(() => resolveGraphqlEndpoint()).toThrow(/EXPO_PUBLIC_API_URL is not set/);
    },
  );

  it('throws when there is no env var and no Expo host at all', () => {
    expect(() => resolveGraphqlEndpoint()).toThrow(/EXPO_PUBLIC_API_URL is not set/);
  });

  it.each([undefined, null, ''])('treats %p as no host', (hostUri) => {
    mockConstants.expoConfig = { hostUri: hostUri as string | undefined };

    expect(() => resolveGraphqlEndpoint()).toThrow(/EXPO_PUBLIC_API_URL is not set/);
  });

  it('ignores a non-string host rather than building a garbage URL', () => {
    mockConstants.expoConfig = { hostUri: 8081 as unknown as string };

    expect(() => resolveGraphqlEndpoint()).toThrow(/EXPO_PUBLIC_API_URL is not set/);
  });
});

describe('getGraphqlEndpoint', () => {
  it('resolves once and keeps the answer', () => {
    // The endpoint cannot change while the app runs, and re-deriving it per
    // request would make a mid-session env change look like it took effect.
    mockEnv.apiUrl = 'https://first.test/graphql';
    expect(getGraphqlEndpoint()).toBe('https://first.test/graphql');

    mockEnv.apiUrl = 'https://second.test/graphql';
    expect(getGraphqlEndpoint()).toBe('https://first.test/graphql');
  });
});

describe('getApiBaseUrl', () => {
  it.each([
    ['https://api.test/graphql', 'https://api.test'],
    ['https://api.test/graphql/', 'https://api.test'],
    ['https://api.test/v2/graphql', 'https://api.test/v2'],
  ])('strips the /graphql suffix: %s → %s', (endpoint, base) => {
    let mod!: typeof import('./endpoint');
    jest.isolateModules(() => {
      mod = require('./endpoint');
    });
    mockEnv.apiUrl = endpoint;

    expect(mod.getApiBaseUrl()).toBe(base);
  });

  it('leaves a URL that does not end in /graphql alone', () => {
    let mod!: typeof import('./endpoint');
    jest.isolateModules(() => {
      mod = require('./endpoint');
    });
    mockEnv.apiUrl = 'https://api.test/gateway';

    expect(mod.getApiBaseUrl()).toBe('https://api.test/gateway');
  });
});
