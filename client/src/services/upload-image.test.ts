/**
 * The presigned-PUT upload path.
 *
 * This module contains the project's most-documented runtime trap (root
 * AGENTS.md, client/AGENTS.md): `new Blob([Uint8Array])` type-checks and then
 * throws on native, which is why the binary PUT goes through
 * `expo-file-system/legacy`'s `uploadAsync` instead.
 *
 * **What is and is not provable from outside.** The throw itself is not
 * reproducible here — jest's `Blob` is the Node one, and it accepts a
 * `Uint8Array` quite happily, so a test that "reproduced" the bug would be
 * asserting the wrong runtime. What *is* provable is the structural property
 * that keeps the trap closed: the bytes are handed to `uploadAsync` as a file
 * URI, and nothing on this path constructs a `Blob` or calls `fetch`. That is
 * asserted negatively below, so reintroducing a fetch+Blob PUT turns it red.
 *
 * `FileSystemUploadType` is mocked with sentinel strings rather than the real
 * numbers so the assertion proves the code selected the `BINARY_CONTENT`
 * *member* — `BINARY_CONTENT` is `0` and `MULTIPART` is `1` upstream, and a
 * numeric assertion would pass just as well against a hardcoded `0`.
 */
import { ApiError } from './api-error';

const mockGraphqlRequest = jest.fn();
jest.mock('./api', () => ({
  graphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
}));

/** Drives `new File(uri).size`, which is the "is the picked file still there" probe. */
const mockFileState: { size: number | null; constructError?: Error } = { size: 4096 };

jest.mock('expo-file-system', () => ({
  // A TS parameter property (`constructor(public uri: string)`) is rejected
  // here: babel-plugin-jest-hoist reads the synthesised assignment as an
  // out-of-scope variable access. Plain field, plain constructor.
  File: class {
    size: number | null;
    uri: string;
    constructor(uri: string) {
      if (mockFileState.constructError) throw mockFileState.constructError;
      this.uri = uri;
      this.size = mockFileState.size;
    }
  },
}));

const mockUploadAsync = jest.fn();
const BINARY_CONTENT = 'sentinel:BINARY_CONTENT';
const MULTIPART = 'sentinel:MULTIPART';

jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  FileSystemUploadType: {
    BINARY_CONTENT: 'sentinel:BINARY_CONTENT',
    MULTIPART: 'sentinel:MULTIPART',
  },
}));

import {
  LocalImageMissingError,
  isRemoteImageUri,
  mimeTypeForUri,
  uploadImageViaPresign,
} from './upload-image';

const LOCAL_URI = 'file:///var/mobile/Containers/Data/tmp/capture-1.jpg';

const PRESIGN = {
  uploadUrl: 'https://s3.test/bucket/readings/abc.jpg?X-Amz-Signature=sig',
  key: 'readings/abc.jpg',
  headers: [
    { name: 'Content-Type', value: 'image/jpeg' },
    { name: 'x-amz-meta-kind', value: 'BLOOD_PRESSURE_READING' },
  ],
};

const CONFIRMED = {
  url: 'https://cdn.test/readings/abc.jpg',
  key: 'readings/abc.jpg',
  imageId: 77,
};

/** Resolves the two mutations in the order the module issues them. */
function happyPathGraphql() {
  mockGraphqlRequest
    .mockResolvedValueOnce({ requestImageUpload: PRESIGN })
    .mockResolvedValueOnce({ confirmImageUpload: CONFIRMED });
}

const blobConstructed = jest.fn();
const RealBlob = globalThis.Blob;
const fetchSpy = jest.fn();

beforeAll(() => {
  globalThis.Blob = class {
    constructor(...args: unknown[]) {
      blobConstructed(...args);
    }
  } as unknown as typeof Blob;
});

afterAll(() => {
  globalThis.Blob = RealBlob;
});

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` does not drain a `mockResolvedValueOnce` queue. A test
  // that rejects before the confirm mutation would otherwise leave the confirm
  // response queued, and the *next* test's presign would receive it — which
  // surfaces as an unrelated "cannot read properties of undefined".
  mockGraphqlRequest.mockReset();
  mockFileState.size = 4096;
  delete mockFileState.constructError;
  mockUploadAsync.mockResolvedValue({ status: 200, body: '' });
  global.fetch = fetchSpy as unknown as typeof fetch;
});

describe('isRemoteImageUri', () => {
  it.each([
    ['https://cdn.test/a.jpg', true],
    ['http://cdn.test/a.jpg', true],
    ['HTTPS://cdn.test/a.jpg', true],
    ['file:///tmp/a.jpg', false],
    ['content://media/1', false],
    ['/tmp/a.jpg', false],
    ['', false],
  ])('%s → %s', (uri, expected) => {
    expect(isRemoteImageUri(uri)).toBe(expected);
  });

  it('treats null and undefined as local', () => {
    expect(isRemoteImageUri(null)).toBe(false);
    expect(isRemoteImageUri(undefined)).toBe(false);
    // A default parameter would not fire here: `undefined` is passed
    // explicitly by callers reading an optional field.
    expect(isRemoteImageUri()).toBe(false);
  });
});

describe('mimeTypeForUri', () => {
  it.each([
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.webp', 'image/webp'],
    ['a.heic', 'image/heic'],
    ['a.HEIC', 'image/heic'],
  ])('%s → %s', (uri, expected) => {
    expect(mimeTypeForUri(uri)).toBe(expected);
  });

  it('ignores a query string, so a presigned-looking URI still maps', () => {
    expect(mimeTypeForUri('https://s3.test/a.png?X-Amz-Signature=sig')).toBe('image/png');
  });

  it('falls back to image/jpeg for an unknown or absent extension', () => {
    expect(mimeTypeForUri('a.gif')).toBe('image/jpeg');
    expect(mimeTypeForUri('capture-with-no-extension')).toBe('image/jpeg');
  });
});

describe('uploadImageViaPresign', () => {
  it('short-circuits a URI that is already on the server', async () => {
    await expect(
      uploadImageViaPresign({ uri: 'https://cdn.test/a.jpg', kind: 'PROFILE' }),
    ).resolves.toEqual({ url: 'https://cdn.test/a.jpg', key: 'https://cdn.test/a.jpg', imageId: null });

    // No presign, no PUT, no confirm — re-uploading an existing object would
    // mint a second Image row for the same bytes.
    expect(mockGraphqlRequest).not.toHaveBeenCalled();
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  describe('the local file is gone', () => {
    it('reports LOCAL_IMAGE_MISSING when the size cannot be read', async () => {
      mockFileState.size = null;

      await expect(uploadImageViaPresign({ uri: LOCAL_URI, kind: 'PROFILE' })).rejects.toMatchObject(
        { name: 'ApiError', code: 'LOCAL_IMAGE_MISSING' },
      );
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('reports LOCAL_IMAGE_MISSING when stat throws outright', async () => {
      mockFileState.constructError = new Error('ENOENT');

      const error = await uploadImageViaPresign({ uri: LOCAL_URI, kind: 'PROFILE' }).catch((e) => e);

      expect(error).toBeInstanceOf(LocalImageMissingError);
      expect(error).toBeInstanceOf(ApiError);
      // `name` is what `isApiError` checks — it is deliberately 'ApiError' and
      // not the subclass name, so the shared error helpers still recognise it.
      expect(error.name).toBe('ApiError');
      expect(error.message).toContain(LOCAL_URI);
    });
  });

  it('presigns with exactly kind, mimeType and size', async () => {
    happyPathGraphql();

    await uploadImageViaPresign({ uri: LOCAL_URI, kind: 'BLOOD_PRESSURE_READING' });

    // toEqual on the whole variables object, not a property spot-check: an
    // extra field silently added here is sent to the gateway.
    expect(mockGraphqlRequest.mock.calls[0][1]).toEqual({
      input: { kind: 'BLOOD_PRESSURE_READING', mimeType: 'image/jpeg', size: 4096 },
    });
    expect(mockGraphqlRequest.mock.calls[0][0]).toContain('mutation RequestImageUpload');
  });

  it('derives the mime type from the URI rather than assuming jpeg', async () => {
    happyPathGraphql();

    await uploadImageViaPresign({ uri: 'file:///tmp/avatar.png', kind: 'PROFILE' });

    expect(mockGraphqlRequest.mock.calls[0][1]).toEqual({
      input: { kind: 'PROFILE', mimeType: 'image/png', size: 4096 },
    });
  });

  it('PUTs the file URI through uploadAsync with the presigned headers', async () => {
    happyPathGraphql();

    await uploadImageViaPresign({ uri: LOCAL_URI, kind: 'BLOOD_PRESSURE_READING' });

    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
    expect(mockUploadAsync.mock.calls[0]).toEqual([
      PRESIGN.uploadUrl,
      // The URI, not bytes. This is the whole point of the file.
      LOCAL_URI,
      {
        httpMethod: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          'x-amz-meta-kind': 'BLOOD_PRESSURE_READING',
        },
        uploadType: BINARY_CONTENT,
      },
    ]);
    expect(mockUploadAsync.mock.calls[0][2].uploadType).not.toBe(MULTIPART);
  });

  it('never materialises the bytes in JS — no Blob, no fetch', async () => {
    // The regression guard for the documented trap. `new Blob([Uint8Array])`
    // type-checks and throws on device; a fetch+Blob PUT reintroduced here
    // would pass every other assertion in this file.
    happyPathGraphql();

    await uploadImageViaPresign({ uri: LOCAL_URI, kind: 'BLOOD_PRESSURE_READING' });

    expect(blobConstructed).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('confirms with the presigned key and the same kind, and returns the row', async () => {
    happyPathGraphql();

    await expect(
      uploadImageViaPresign({ uri: LOCAL_URI, kind: 'BLOOD_PRESSURE_READING' }),
    ).resolves.toEqual(CONFIRMED);

    expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
      input: { key: PRESIGN.key, kind: 'BLOOD_PRESSURE_READING' },
    });
    expect(mockGraphqlRequest.mock.calls[1][0]).toContain('mutation ConfirmImageUpload');
  });

  it('confirms the key S3 was given, not the URI the user picked', async () => {
    happyPathGraphql();

    await uploadImageViaPresign({ uri: LOCAL_URI, kind: 'PROFILE' });

    const confirmInput = mockGraphqlRequest.mock.calls[1][1] as { input: { key: string } };
    expect(confirmInput.input.key).toBe(PRESIGN.key);
    expect(confirmInput.input.key).not.toBe(LOCAL_URI);
  });

  describe('the S3 PUT fails', () => {
    it.each([400, 403, 500, 199])('rejects on status %s', async (status) => {
      happyPathGraphql();
      mockUploadAsync.mockResolvedValue({ status, body: 'nope' });

      await expect(
        uploadImageViaPresign({ uri: LOCAL_URI, kind: 'PROFILE' }),
      ).rejects.toMatchObject({ name: 'ApiError', code: 'UPLOAD_FAILED', httpStatus: status });
    });

    it('does not confirm an upload that never landed', async () => {
      // Confirming a failed PUT writes an Image row pointing at an object
      // that is not in the bucket — a broken image the patient cannot fix.
      happyPathGraphql();
      mockUploadAsync.mockResolvedValue({ status: 403, body: 'AccessDenied' });

      await expect(uploadImageViaPresign({ uri: LOCAL_URI, kind: 'PROFILE' })).rejects.toThrow();

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
    });
  });

  it.each([200, 201, 204, 299])('accepts any 2xx from S3 (%s)', async (status) => {
    happyPathGraphql();
    mockUploadAsync.mockResolvedValue({ status, body: '' });

    await expect(uploadImageViaPresign({ uri: LOCAL_URI, kind: 'PROFILE' })).resolves.toEqual(
      CONFIRMED,
    );
  });
});

describe('on web', () => {
  it('refuses with UPLOAD_UNSUPPORTED instead of falling back to a Blob path', async () => {
    // The web branch was deleted rather than left broken; this asserts it
    // stayed deleted. Loaded through an isolate because `Platform.OS` is read
    // at call time but a file-level react-native mock breaks jest-expo's setup
    // — see the same note in auth-token.test.ts.
    let mod!: typeof import('./upload-image');
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
      mod = require('./upload-image');
    });
    jest.dontMock('react-native');

    await expect(mod.uploadImageViaPresign({ uri: LOCAL_URI, kind: 'PROFILE' })).rejects.toMatchObject(
      { name: 'ApiError', code: 'UPLOAD_UNSUPPORTED' },
    );
    expect(mockGraphqlRequest).not.toHaveBeenCalled();
    expect(blobConstructed).not.toHaveBeenCalled();
  });

  it('still short-circuits a remote URI, because nothing needs uploading', async () => {
    let mod!: typeof import('./upload-image');
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
      mod = require('./upload-image');
    });
    jest.dontMock('react-native');

    await expect(
      mod.uploadImageViaPresign({ uri: 'https://cdn.test/a.jpg', kind: 'PROFILE' }),
    ).resolves.toEqual({ url: 'https://cdn.test/a.jpg', key: 'https://cdn.test/a.jpg', imageId: null });
  });
});
