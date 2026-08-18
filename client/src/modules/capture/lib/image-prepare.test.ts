/**
 * The single re-encode on the capture path.
 *
 * Two things are being locked here, and they fail in opposite directions.
 *
 * The *conflict* rule: long edge ≤ 1600 is a soft cap, short edge ≥ 512 is a
 * hard floor, and when a pathological input makes both impossible the floor
 * wins. Getting that backwards produces an image the backend detector silently
 * upscales, which costs accuracy on a path where nothing reports an error.
 *
 * The *generation count*: crop and resize are one chain and one `saveAsync`.
 * Splitting them back apart would not fail any assertion about the numbers —
 * it would just quietly put another round of JPEG ringing on the thin,
 * high-contrast strokes the CRNN reads. So the number of saves is asserted
 * directly.
 */
const mockSaveAsync = jest.fn();
const mockRenderAsync = jest.fn();
const mockResize = jest.fn();
const mockCrop = jest.fn();
const mockManipulate = jest.fn();

/** Chain links in the order they were applied. */
let chain: string[] = [];

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: (...args: unknown[]) => mockManipulate(...args),
  },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

import { prepareCaptureForAnalysis, prepareImageForAnalysis } from './image-prepare';

const SOURCE = 'file:///tmp/capture.jpg';

/** A 9:16 portrait viewport over a 4:3 landscape sensor — the real camera case. */
const VIEWPORT = 9 / 16;

/** The single-axis argument the module hands `resize()`. */
const resizeArg = () => mockResize.mock.calls[0][0] as { width?: number; height?: number };

/** The rectangle the module hands `crop()`. */
const cropArg = () => mockCrop.mock.calls[0][0] as Record<string, number>;

beforeEach(() => {
  jest.clearAllMocks();
  chain = [];

  const context = {
    crop: (...args: unknown[]) => {
      chain.push('crop');
      mockCrop(...args);
      return context;
    },
    resize: (...args: unknown[]) => {
      chain.push('resize');
      mockResize(...args);
      return context;
    },
    renderAsync: () => mockRenderAsync(),
  };

  mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/small.jpg', width: 1600, height: 1200 });
  mockRenderAsync.mockResolvedValue({ saveAsync: mockSaveAsync });
  mockManipulate.mockReturnValue(context);
});

describe('one chain, one encode', () => {
  it('crops and resizes a camera capture in a single save', async () => {
    // 4032×3024 cover-fit into 9:16 → a 1701×3024 box, whose long edge is then
    // over the cap. Both links, one file written.
    await prepareCaptureForAnalysis(SOURCE, 4032, 3024, VIEWPORT);

    expect(mockManipulate).toHaveBeenCalledTimes(1);
    expect(mockSaveAsync).toHaveBeenCalledTimes(1);
    expect(chain).toEqual(['crop', 'resize']);
  });

  it('crops before it resizes', async () => {
    // Order is not cosmetic: the resize target is computed from the cropped
    // size, so resizing first would apply the cap to pixels about to be
    // thrown away and land the result under the floor.
    await prepareCaptureForAnalysis(SOURCE, 4032, 3024, VIEWPORT);

    expect(chain.indexOf('crop')).toBeLessThan(chain.indexOf('resize'));
    expect(cropArg()).toEqual({ originX: 1165, originY: 0, width: 1701, height: 3024 });
    expect(resizeArg()).toEqual({ height: 1600 });
  });

  it('saves as JPEG at the shared quality budget', async () => {
    // 0.9, not the 0.7 the two separate stages each used: the quantiser was
    // eating the seven-segment transitions that are the signal, twice.
    await prepareCaptureForAnalysis(SOURCE, 4032, 3024, VIEWPORT);

    expect(mockSaveAsync).toHaveBeenCalledWith({ compress: 0.9, format: 'jpeg' });
  });

  it('uses the same quality for a gallery pick', async () => {
    await prepareImageForAnalysis(SOURCE, 4032, 3024);

    expect(mockSaveAsync).toHaveBeenCalledWith({ compress: 0.9, format: 'jpeg' });
  });
});

describe('the gallery path', () => {
  it('never crops', async () => {
    // A gallery pick was never bound to a preview, so there is no cover-fit
    // mismatch to undo and a crop would only throw away image area.
    await prepareImageForAnalysis(SOURCE, 4032, 3024);

    expect(chain).toEqual(['resize']);
    expect(mockCrop).not.toHaveBeenCalled();
  });

  it.each([
    ['zero width', 0, 100],
    ['zero height', 100, 0],
    ['negative width', -1200, 900],
    ['NaN height', 1200, Number.NaN],
    ['infinite width', Number.POSITIVE_INFINITY, 900],
  ])(
    'passes a %s asset through untouched rather than computing a NaN target',
    async (_label, width, height) => {
      // Reachable: these are `asset.width` / `asset.height` off a malformed
      // gallery pick. The scale factor would come out Infinity or NaN, and a
      // resize request built from it is worse than no resize — the manipulator
      // is the wrong place to discover it.
      await expect(prepareImageForAnalysis(SOURCE, width, height)).resolves.toEqual({
        uri: SOURCE,
        width,
        height,
      });

      expect(mockManipulate).not.toHaveBeenCalled();
    },
  );

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

describe('the camera path', () => {
  it('skips the re-encode when there is neither a crop nor a resize to make', async () => {
    // Viewport aspect already matches the photo and it is inside both bounds.
    await expect(prepareCaptureForAnalysis(SOURCE, 1400, 1000, 1.4)).resolves.toEqual({
      uri: SOURCE,
      width: 1400,
      height: 1000,
    });

    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('crops without resizing when the cropped image is already inside both bounds', async () => {
    // 1400×1000 into 9:16 → 563×1000: long edge under the cap, short edge over
    // the floor. Nothing left to scale.
    await prepareCaptureForAnalysis(SOURCE, 1400, 1000, VIEWPORT);

    expect(chain).toEqual(['crop']);
    expect(cropArg()).toEqual({ originX: 418, originY: 0, width: 563, height: 1000 });
  });

  it('resizes without cropping when the photo already matches the viewport', async () => {
    await prepareCaptureForAnalysis(SOURCE, 4032, 3024, 4032 / 3024);

    expect(chain).toEqual(['resize']);
    expect(resizeArg()).toEqual({ width: 1600 });
  });

  it('treats an unmeasured viewport as "no crop" rather than failing the capture', async () => {
    // The screen passes `viewportAspect.current ?? 0` — a layout that has not
    // reported yet must still produce a usable photo.
    await prepareCaptureForAnalysis(SOURCE, 4032, 3024, 0);

    expect(mockCrop).not.toHaveBeenCalled();
    expect(chain).toEqual(['resize']);
  });

  it('applies the bounds to the cropped size, not the photo size', async () => {
    // 1400×1000 needs no resize on its own — inside both bounds. Cropped to a
    // narrow 0.3 viewport it becomes 300×1000, and the short edge is now under
    // the 512 floor. Measuring the photo instead of the crop would ship the
    // backend an image it has to upscale, silently.
    await prepareCaptureForAnalysis(SOURCE, 1400, 1000, 0.3);

    expect(cropArg()).toEqual({ originX: 550, originY: 0, width: 300, height: 1000 });
    expect(resizeArg()).toEqual({ height: 1707 });
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

  it('falls back to the resized target on the camera path, not the crop box', async () => {
    mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/small.jpg', width: 0, height: 0 });

    await expect(prepareCaptureForAnalysis(SOURCE, 4032, 3024, VIEWPORT)).resolves.toEqual({
      uri: 'file:///tmp/small.jpg',
      width: 900,
      height: 1600,
    });
  });

  it('falls back to the crop box when that is the only link', async () => {
    mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/cropped.jpg', width: 0, height: 0 });

    await expect(prepareCaptureForAnalysis(SOURCE, 1400, 1000, VIEWPORT)).resolves.toEqual({
      uri: 'file:///tmp/cropped.jpg',
      width: 563,
      height: 1000,
    });
  });

  it('never returns a zero dimension for a degenerate input', async () => {
    mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/small.jpg', width: 0, height: 0 });

    const result = await prepareImageForAnalysis(SOURCE, 20000, 1);

    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('keeps the original when the chain throws', async () => {
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

  it('keeps the uncropped original when a camera-path chain throws', async () => {
    // A wider field of view than the preview showed is a much better outcome
    // than a capture that cannot complete.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRenderAsync.mockRejectedValue(new Error('decode failed'));

    await expect(prepareCaptureForAnalysis(SOURCE, 4032, 3024, VIEWPORT)).resolves.toEqual({
      uri: SOURCE,
      width: 4032,
      height: 3024,
    });

    warn.mockRestore();
  });
});
