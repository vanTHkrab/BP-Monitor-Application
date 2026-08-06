/**
 * WYSIWYG for the capture: crop the photo down to what the preview showed.
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
 * image area for nothing.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Same quality budget as `image-prepare.ts` — one number, not two. */
const COMPRESS_QUALITY = 0.7;

export interface CroppedImage {
  uri: string;
  width: number;
  height: number;
}

/** A centred crop box in source-photo pixels, shaped for `ImageManipulator`. */
export interface CoverCropBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * The geometry, separated from the I/O so it can be asserted.
 *
 * Returns `null` when the input is degenerate or the photo already matches the
 * viewport — both mean "no crop", and the caller skips the re-encode. This is
 * also the assertion point if the two capture paths (`expo-camera` and the
 * native CameraX view) ever drift on the width/height convention they report.
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

/**
 * Crop, or return the original.
 *
 * Dimensions come from the caller because both capture paths already report
 * them; `Image.getSize` has been observed to hang on a freshly written camera
 * URI on some Android devices, which stuck the capture UI.
 *
 * A manipulator failure returns the uncropped image rather than propagating: a
 * slightly wider field of view than the preview showed is a much better outcome
 * than a capture that cannot complete.
 */
export const cropToViewport = async (
  uri: string,
  photoWidth: number,
  photoHeight: number,
  viewportAspect: number,
): Promise<CroppedImage> => {
  const box = computeCoverCropBox(photoWidth, photoHeight, viewportAspect);
  if (!box) return { uri, width: photoWidth, height: photoHeight };

  try {
    const rendered = await ImageManipulator.manipulate(uri).crop(box).renderAsync();
    const result = await rendered.saveAsync({
      compress: COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
    });
    return {
      uri: result.uri,
      width: result.width || box.width,
      height: result.height || box.height,
    };
  } catch (error) {
    if (__DEV__) console.warn('[crop-to-viewport] crop failed; keeping the original', error);
    return { uri, width: photoWidth, height: photoHeight };
  }
};
