/**
 * WYSIWYG crop geometry for the camera path.
 *
 * `computeCoverCropBox` is pure — the crop it describes is executed as one
 * link of the single manipulator chain in `image-prepare.ts` — and it is the
 * half that matters: a wrong box is not a crash, it is a saved JPEG that no
 * longer matches what the framing gate approved, which then reads as a
 * detector regression on the server.
 */
import { computeCoverCropBox } from './crop-to-viewport';

describe('computeCoverCropBox', () => {
  it('crops the sides of a photo wider than the viewport', () => {
    // 4:3 sensor (4032×3024) shown in a 9:16 portrait viewport.
    const box = computeCoverCropBox(4032, 3024, 9 / 16);

    expect(box).toEqual({ originX: 1165, originY: 0, width: 1701, height: 3024 });
  });

  it('crops the top and bottom of a photo taller than the viewport', () => {
    // 3:4 sensor (3024×4032) shown in a square viewport.
    const box = computeCoverCropBox(3024, 4032, 1);

    expect(box).toEqual({ originX: 0, originY: 504, width: 3024, height: 3024 });
  });

  it('centres the box on both axes', () => {
    const box = computeCoverCropBox(1000, 500, 1)!;

    expect(box.originX).toBe((1000 - box.width) / 2);
    expect(box.originY).toBe(0);
  });

  it('keeps the box inside the source image', () => {
    // An out-of-bounds box is what the manipulator throws on, and the catch
    // below would silently hand back an uncropped photo.
    const box = computeCoverCropBox(4032, 3024, 0.01)!;

    expect(box.originX + box.width).toBeLessThanOrEqual(4032);
    expect(box.originY + box.height).toBeLessThanOrEqual(3024);
    expect(box.width).toBeGreaterThanOrEqual(1);
    expect(box.height).toBeGreaterThanOrEqual(1);
  });

  it('produces a box whose aspect matches the viewport', () => {
    const box = computeCoverCropBox(4032, 3024, 9 / 16)!;

    expect(box.width / box.height).toBeCloseTo(9 / 16, 3);
  });

  it('returns null when the aspects already agree — nothing to crop', () => {
    expect(computeCoverCropBox(1080, 1920, 1080 / 1920)).toBeNull();
    expect(computeCoverCropBox(1000, 1000, 1)).toBeNull();
  });

  it.each([
    ['zero width', 0, 100, 1],
    ['zero height', 100, 0, 1],
    ['zero aspect', 100, 100, 0],
    ['negative width', -100, 100, 1],
    ['negative height', 100, -100, 1],
    ['negative aspect', 100, 100, -1],
    ['NaN width', Number.NaN, 100, 1],
    ['NaN height', 100, Number.NaN, 1],
    ['NaN aspect', 100, 100, Number.NaN],
    ['infinite width', Number.POSITIVE_INFINITY, 100, 1],
    ['infinite aspect', 100, 100, Number.POSITIVE_INFINITY],
  ])('returns null for %s', (_label, width, height, aspect) => {
    expect(computeCoverCropBox(width, height, aspect)).toBeNull();
  });
});
