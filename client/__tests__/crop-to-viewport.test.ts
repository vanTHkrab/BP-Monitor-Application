import { computeCoverCropBox } from "@/utils/crop-to-viewport";

/**
 * Locks the WYSIWYG reverse-cover geometry — the contract both camera capture
 * paths (`expo-camera`'s `takePictureAsync` and the native CameraX `capture()`)
 * feed into. If either path ever drifts on the width/height convention it
 * reports for an upright JPEG, the "returned box aspect == viewportAspect"
 * assertion below is what catches the silent breakage.
 */
describe("computeCoverCropBox", () => {
  it("crops left/right (keeps full height) when the photo is wider than the viewport", () => {
    // 4:3 photo (1.333) into a tall 9:16 viewport (0.5625) → crop the sides.
    const box = computeCoverCropBox(4000, 3000, 9 / 16);
    expect(box).not.toBeNull();
    expect(box!.height).toBe(3000); // full height kept
    expect(box!.width).toBe(Math.round(3000 * (9 / 16))); // 1688
    expect(box!.width).toBeLessThan(4000); // sides cropped
  });

  it("crops top/bottom (keeps full width) when the photo is taller than the viewport", () => {
    // 3:4 photo (0.75) into a wide 16:9 viewport (1.777) → crop top/bottom.
    const box = computeCoverCropBox(3000, 4000, 16 / 9);
    expect(box).not.toBeNull();
    expect(box!.width).toBe(3000); // full width kept
    expect(box!.height).toBe(Math.round(3000 / (16 / 9))); // 1688
    expect(box!.height).toBeLessThan(4000); // top/bottom cropped
  });

  it("returns a box whose aspect matches the viewport aspect (the WYSIWYG invariant)", () => {
    const viewportAspect = 0.62; // a real-ish full-screen phone viewport (w/h)
    const box = computeCoverCropBox(4032, 3024, viewportAspect);
    expect(box).not.toBeNull();
    const boxAspect = box!.width / box!.height;
    // Within 1px of rounding on either dimension.
    expect(boxAspect).toBeCloseTo(viewportAspect, 2);
  });

  it("centers the crop box on the source photo", () => {
    const box = computeCoverCropBox(4000, 3000, 9 / 16);
    expect(box).not.toBeNull();
    // originX/originY are the symmetric margins: (full - cropped) / 2.
    expect(box!.originX).toBe(Math.floor((4000 - box!.width) / 2));
    expect(box!.originY).toBe(Math.floor((3000 - box!.height) / 2));
  });

  it("returns null (no crop) when the photo already matches the viewport aspect", () => {
    // Square photo, square viewport → nothing to crop.
    expect(computeCoverCropBox(2000, 2000, 1)).toBeNull();
  });

  it("returns null for degenerate inputs so the caller keeps the original image", () => {
    expect(computeCoverCropBox(0, 3000, 0.6)).toBeNull();
    expect(computeCoverCropBox(4000, 0, 0.6)).toBeNull();
    expect(computeCoverCropBox(4000, 3000, 0)).toBeNull();
    expect(computeCoverCropBox(-4000, 3000, 0.6)).toBeNull();
    expect(computeCoverCropBox(Number.NaN, 3000, 0.6)).toBeNull();
    expect(computeCoverCropBox(4000, 3000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("keeps the crop box within the source bounds", () => {
    const box = computeCoverCropBox(1080, 1920, 0.75);
    expect(box).not.toBeNull();
    expect(box!.originX).toBeGreaterThanOrEqual(0);
    expect(box!.originY).toBeGreaterThanOrEqual(0);
    expect(box!.originX + box!.width).toBeLessThanOrEqual(1080);
    expect(box!.originY + box!.height).toBeLessThanOrEqual(1920);
  });
});
