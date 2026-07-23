import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// JPEG re-compression for the cropped output. Matches the COMPRESS_QUALITY in
// image-prepare.ts so the camera path doesn't introduce a second, divergent
// quality budget — 0.7 keeps the smaller pulse digits legible.
const COMPRESS_QUALITY = 0.7;

export interface CroppedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Center-crop a captured photo so its aspect ratio matches the on-screen
 * camera viewport — making "what was captured" equal "what was framed"
 * (WYSIWYG).
 *
 * ## Why this exists
 *
 * The camera UI renders `CameraView` as `absolute inset-0` (full-screen) with
 * the native preview in **cover** fit: the sensor feed is scaled up until it
 * fills the screen and the overflow is cropped off-screen. But
 * `takePictureAsync` returns the **full sensor frame** (typically ~4:3), which
 * is wider/taller than what the cover-fit preview actually showed. The result
 * is that anything the user lined up inside the on-screen guide frame appears
 * smaller / further away in the saved JPEG than it did in the preview.
 *
 * This helper replicates the cover transform in reverse: given the captured
 * photo dimensions and the viewport aspect ratio, it center-crops the photo to
 * the visible region so the bytes leaving this function show exactly the field
 * of view the preview showed.
 *
 * ## Cover-crop math
 *
 * `cover` scales the source so the *smaller* relative dimension fills the view,
 * cropping the larger one. Equivalently, the visible region of the source is
 * the largest centered rectangle whose aspect equals the viewport aspect:
 *
 *   - photoAspect (= w/h) > viewportAspect → photo is relatively wider than the
 *     screen, so left/right are cropped:  visibleW = photoH * viewportAspect
 *   - photoAspect < viewportAspect         → photo is relatively taller, so
 *     top/bottom are cropped:             visibleH = photoW / viewportAspect
 *   - equal aspects                         → no crop needed
 *
 * The crop is centered: originX/originY = (full - visible) / 2.
 *
 * ## Failure handling
 *
 * On any invalid input (non-finite / non-positive dimensions or aspect) or a
 * manipulator failure, the original URI + dimensions are returned so the camera
 * flow keeps working with the un-cropped image rather than blocking on the
 * crop. The trade-off (slightly more captured field of view than the preview
 * showed) is strictly better than a stuck capture.
 *
 * Dimensions come from the caller (`takePictureAsync` returns width/height on
 * the photo) — we never call `Image.getSize`, which has been observed to hang
 * on a freshly-written camera URI on some Android devices.
 *
 * NOTE: only the live-camera capture path should use this. Gallery picks are
 * not bound to the live preview, so there is no preview/capture mismatch to
 * correct and cropping them would discard image area for no reason.
 */
export const cropToViewport = async (
  uri: string,
  photoWidth: number,
  photoHeight: number,
  viewportAspect: number,
): Promise<CroppedImage> => {
  // Guard against degenerate inputs — a zero/NaN dimension or aspect would
  // produce a nonsense crop box (or divide-by-zero), so bail to the original.
  if (
    !Number.isFinite(photoWidth) ||
    !Number.isFinite(photoHeight) ||
    !Number.isFinite(viewportAspect) ||
    photoWidth <= 0 ||
    photoHeight <= 0 ||
    viewportAspect <= 0
  ) {
    return { uri, width: photoWidth, height: photoHeight };
  }

  const photoAspect = photoWidth / photoHeight;

  // Compute the largest centered rectangle of the photo whose aspect matches
  // the viewport. One axis stays full; the other shrinks.
  let visibleW: number;
  let visibleH: number;
  if (photoAspect > viewportAspect) {
    // Photo wider than viewport → crop left/right, keep full height.
    visibleH = photoHeight;
    visibleW = photoHeight * viewportAspect;
  } else {
    // Photo taller than viewport → crop top/bottom, keep full width.
    visibleW = photoWidth;
    visibleH = photoWidth / viewportAspect;
  }

  const cropW = Math.max(1, Math.min(photoWidth, Math.round(visibleW)));
  const cropH = Math.max(1, Math.min(photoHeight, Math.round(visibleH)));
  const originX = Math.max(0, Math.floor((photoWidth - cropW) / 2));
  const originY = Math.max(0, Math.floor((photoHeight - cropH) / 2));

  // Aspects already match (within rounding) → nothing to crop, skip the
  // re-encode pass entirely.
  if (cropW >= photoWidth && cropH >= photoHeight) {
    return { uri, width: photoWidth, height: photoHeight };
  }

  try {
    // v14 contextual API — `manipulateAsync` is deprecated.
    const ref = await ImageManipulator.manipulate(uri)
      .crop({ originX, originY, width: cropW, height: cropH })
      .renderAsync();
    const result = await ref.saveAsync({
      compress: COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
    });
    return {
      uri: result.uri,
      width: result.width || cropW,
      height: result.height || cropH,
    };
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[crop-to-viewport] crop failed, falling back to original URI',
        error,
      );
    }
    return { uri, width: photoWidth, height: photoHeight };
  }
};
