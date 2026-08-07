/**
 * Pre-upload downscale.
 *
 * The invariant with teeth is the *conflict* rule: long edge ≤ 1600 is a soft
 * cap, short edge ≥ 512 is a hard floor, and when a pathological input makes
 * both impossible the floor wins. Getting that backwards produces an image the
 * backend detector silently upscales, which costs accuracy on a path where
 * nothing reports an error.
 */
const mockSaveAsync = jest.fn();
const mockRenderAsync = jest.fn();
const mockResize = jest.fn();
const mockManipulate = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: (...args: unknown[]) => mockManipulate(...args),
  },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

import { prepareImageForAnalysis } from './image-prepare';

const SOURCE = 'file:///tmp/capture.jpg';

/** The single-axis argument the module hands `resize()`. */
const resizeArg = () => mockResize.mock.calls[0][0] as { width?: number; height?: number };

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/small.jpg', width: 1600, height: 1200 });
  mockRenderAsync.mockResolvedValue({ saveAsync: mockSaveAsync });
  mockResize.mockReturnValue({ renderAsync: mockRenderAsync });
  mockManipulate.mockReturnValue({ resize: mockResize });
});

describe('inside both bounds', () => {
  it.each([
    ['exactly at the cap and the floor', 1600, 512],
    ['comfortably inside', 1280, 720],
    ['square, inside', 1000, 1000],
    ['square, exactly at the floor', 512, 512],
  ])('%s (%s×%s) skips the re-encode entirely', async (_label, width, height) => {
    await expect(prepareImageForAnalysis(SOURCE, width, height)).resolves.toEqual({
      uri: SOURCE,
      width,
      height,
    });

    expect(mockManipulate).not.toHaveBeenCalled();
  });
});

describe('over the long-edge cap', () => {
  it('scales a landscape photo by its width', async () => {
    // 4032×3024 → scale 1600/4032, so width is the axis specified and the
    // manipulator derives the height itself.
    await prepareImageForAnalysis(SOURCE, 4032, 3024);

    expect(mockManipulate).toHaveBeenCalledWith(SOURCE);
    expect(resizeArg()).toEqual({ width: 1600 });
  });

  it('scales a portrait photo by its height', async () => {
    await prepareImageForAnalysis(SOURCE, 3024, 4032);

    expect(resizeArg()).toEqual({ height: 1600 });
  });

  it('specifies exactly one axis, so the aspect ratio is the manipulator’s job', async () => {
    // Passing both would trust two independently rounded numbers and can
    // stretch the image by a pixel — enough to move a digit box.
    await prepareImageForAnalysis(SOURCE, 4032, 3024);

    expect(Object.keys(resizeArg())).toHaveLength(1);
  });

  it('saves as JPEG at the shared quality budget', async () => {
    await prepareImageForAnalysis(SOURCE, 4032, 3024);

    expect(mockSaveAsync).toHaveBeenCalledWith({ compress: 0.7, format: 'jpeg' });
  });
});

describe('under the short-edge floor', () => {
  it('upscales a small image to reach 512 on the short edge', async () => {
    // 640×384 → scale 512/384, width becomes ~853.
    await prepareImageForAnalysis(SOURCE, 640, 384);

    expect(resizeArg()).toEqual({ width: 853 });
  });

  it('upscales by height when the image is portrait', async () => {
    await prepareImageForAnalysis(SOURCE, 384, 640);

    expect(resizeArg()).toEqual({ height: 853 });
  });

  it('lets the floor win over the cap when both cannot hold', async () => {
    // A 4000×200 banner: satisfying the cap would push the short edge to 25.
    // The pipeline cannot recover from a sub-512 input but copes fine with an
    // oversized long edge, so the floor is resolved first.
    await prepareImageForAnalysis(SOURCE, 4000, 200);

    // 512/200 = 2.56 → width 10240, far past the 1600 cap, and deliberately so.
    expect(resizeArg()).toEqual({ width: 10240 });
  });
});

describe('the result', () => {
  it('reports the dimensions the manipulator produced, not the ones requested', async () => {
    mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/small.jpg', width: 1600, height: 1201 });

    await expect(prepareImageForAnalysis(SOURCE, 4032, 3024)).resolves.toEqual({
      uri: 'file:///tmp/small.jpg',
      width: 1600,
      height: 1201,
    });
  });

  it('falls back to the computed target when the result reports zeros', async () => {
    mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/small.jpg', width: 0, height: 0 });

    await expect(prepareImageForAnalysis(SOURCE, 4032, 3024)).resolves.toEqual({
      uri: 'file:///tmp/small.jpg',
      width: 1600,
      height: 1200,
    });
  });

  it('never returns a zero dimension for a degenerate input', async () => {
    mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/small.jpg', width: 0, height: 0 });

    const result = await prepareImageForAnalysis(SOURCE, 20000, 1);

    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('keeps the original when the resize throws', async () => {
    // An oversized upload is slow; a blocked capture is broken.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRenderAsync.mockRejectedValue(new Error('decode failed'));

    await expect(prepareImageForAnalysis(SOURCE, 4032, 3024)).resolves.toEqual({
      uri: SOURCE,
      width: 4032,
      height: 3024,
    });

    warn.mockRestore();
  });

  it('keeps the original when saving throws', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveAsync.mockRejectedValue(new Error('out of disk'));

    await expect(prepareImageForAnalysis(SOURCE, 4032, 3024)).resolves.toEqual({
      uri: SOURCE,
      width: 4032,
      height: 3024,
    });

    warn.mockRestore();
  });
});
