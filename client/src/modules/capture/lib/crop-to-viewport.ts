/**
 * WYSIWYG for the capture: the geometry that crops a photo down to what the
 * preview showed.
 *
 * The preview fills the screen in **cover** fit — the sensor feed is scaled up
 * until it covers the viewport and the overflow is cut off-screen. But the
 * capture returns the *whole* sensor frame (usually ~4:3), which is wider or
 * taller than what the user was looking at. Without this, a monitor lined up
 * inside the on-screen guide frame comes out smaller and further away in the
 * saved JPEG than it appeared, and the detector then has less to work with
 * than the framing gate promised.
 *
 * So this replays the cover transform in reverse: the largest centred
 * rectangle of the photo whose aspect matches the viewport.
 *
 * Only the live-camera path should use it. A gallery pick was never bound to a
 * preview, so there is no mismatch to correct and cropping would throw away
 * image area for nothing. That split is enforced by which function the caller
 * reaches for in `image-prepare.ts` — `prepareCaptureForAnalysis` applies this
 * box, `prepareImageForAnalysis` does not.
 *
 * **Pure geometry, no I/O.** The crop is executed as one link of the single
 * manipulator chain in `image-prepare.ts`, because every extra `saveAsync` is
 * another generation of JPEG loss on strokes that are already the worst case
 * for it. Keeping the box computable without touching a file is what lets the
 * rule be asserted: a wrong box is not a crash, it is a saved JPEG that no
 * longer matches what the framing gate approved.
 */

/** A centred crop box in source-photo pixels, shaped for `ImageManipulator`. */
export interface CoverCropBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * The largest centred rectangle of the photo matching the viewport's aspect.
 *
 * Returns `null` when the input is degenerate or the photo already matches the
 * viewport — both mean "no crop", and the caller drops the link from the
 * chain. This is also the assertion point if the two capture paths
 * (`expo-camera` and the native CameraX view) ever drift on the width/height
 * convention they report.
 */
export const computeCoverCropBox = (
  photoWidth: number,
  photoHeight: number,
  viewportAspect: number,
): CoverCropBox | null => {
  if (
    !Number.isFinite(photoWidth) ||
    !Number.isFinite(photoHeight) ||
    !Number.isFinite(viewportAspect) ||
    photoWidth <= 0 ||
    photoHeight <= 0 ||
    viewportAspect <= 0
  ) {
    return null;
  }

  const photoAspect = photoWidth / photoHeight;

  // One axis stays full; the other shrinks to match the viewport's aspect.
  let visibleWidth: number;
  let visibleHeight: number;
  if (photoAspect > viewportAspect) {
    // Photo relatively wider → the sides were cropped off-screen.
    visibleHeight = photoHeight;
    visibleWidth = photoHeight * viewportAspect;
  } else {
    // Photo relatively taller → top and bottom were.
    visibleWidth = photoWidth;
    visibleHeight = photoWidth / viewportAspect;
  }

  const width = Math.max(1, Math.min(photoWidth, Math.round(visibleWidth)));
  const height = Math.max(1, Math.min(photoHeight, Math.round(visibleHeight)));

  // Aspects already agree, within rounding.
  if (width >= photoWidth && height >= photoHeight) return null;

  return {
    originX: Math.max(0, Math.floor((photoWidth - width) / 2)),
    originY: Math.max(0, Math.floor((photoHeight - height) / 2)),
    width,
    height,
  };
};
