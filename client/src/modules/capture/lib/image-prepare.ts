/**
 * The one place a capture is re-encoded before anything else sees it.
 *
 * Two jobs, deliberately fused into a single `ImageManipulator` chain and a
 * single `saveAsync`: crop the live-camera photo back to what the preview
 * showed (see `crop-to-viewport.ts`), and shrink it.
 *
 * **Why one save and not two.** Seven-segment digits are thin, high-contrast
 * strokes — the worst case for JPEG ringing — and the CRNN was trained on
 * clean crops. The capture already arrives having been encoded by the camera
 * and again by `writeUprightJpeg`; adding a crop save *and* a resize save on
 * top made four generations of loss on the exact edges the recogniser reads.
 * Chaining `.crop().resize()` costs one decode and one encode for both.
 *
 * ## Shrinking
 *
 * A 4032×3024 photo is ~25 MB of pixels and buys nothing: BP-monitor digits
 * stay legible far below 4K, and every byte past that is upload time on a
 * phone connection, S3 spend, and decode time in ai-service. The same scene at
 * 1600 px is ~4 MB.
 *
 * Two invariants on the output, and they can disagree:
 *   - long edge  ≤ 1600 px — a soft cap, downscaled when over.
 *   - short edge ≥ 512 px  — a hard floor, matching the backend detector's
 *     letterbox target. Below it the backend would upscale anyway, so the
 *     resize happens here on a native code path instead.
 *
 * For a pathological input where both cannot hold (a 4000×200 banner), the
 * floor wins: the pipeline cannot recover from a sub-512 input, but it copes
 * fine with an oversized long edge.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { computeCoverCropBox, type CoverCropBox } from './crop-to-viewport';

const MAX_LONG_EDGE_PX = 1600;
const MIN_SHORT_EDGE_PX = 512;

/**
 * The single quality budget for the whole capture path — one number, not two,
 * now that there is only one encode to spend it on.
 *
 * 0.9 rather than the 0.7 the two separate stages each used. At 0.7 the JPEG
 * quantiser starts eating the transitions that *are* the signal on a
 * seven-segment display, and it was doing so twice.
 *
 * It is not free: on a ~1.4 MP capture (900×1600, the common cropped result)
 * expect a couple of hundred kilobytes more — close to a doubling of the file,
 * not a rounding error. It is still the right trade. The resize above bounds
 * the absolute size, `@/services/upload-image` stats the real file and
 * declares that size when it asks the gateway to presign, so a larger file is
 * an honestly-declared larger file rather than a surprise at the far end, and
 * the same copy serves both jobs — a second, higher-quality copy for OCR would
 * mean carrying two URIs through the offline queue for the life of the row.
 */
const COMPRESS_QUALITY = 0.9;

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * A resize link: the single axis handed to `.resize()`, plus the dimensions it
 * is expected to produce.
 */
interface ResizePlan {
  axis: { width: number } | { height: number };
  width: number;
  height: number;
}

/**
 * The resize decision, as arithmetic. `null` means the image is already inside
 * both bounds and the link is dropped — which, when the crop is also absent,
 * is what lets the whole re-encode be skipped.
 *
 * Only one axis is specified so the manipulator preserves the aspect ratio
 * itself rather than trusting two independently rounded numbers; passing both
 * can stretch the image by a pixel, which is enough to move a digit box.
 */
const computeResizePlan = (width: number, height: number): ResizePlan | null => {
  // A degenerate size has no sane target, and the scale below would come out
  // Infinity or NaN. "No resize" is the only honest answer.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);

  if (longEdge <= MAX_LONG_EDGE_PX && shortEdge >= MIN_SHORT_EDGE_PX) return null;

  // The floor wins when the two disagree, so it is resolved first.
  const scale =
    shortEdge < MIN_SHORT_EDGE_PX
      ? MIN_SHORT_EDGE_PX / shortEdge
      : MAX_LONG_EDGE_PX / longEdge;

  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  return {
    axis: width >= height ? { width: targetWidth } : { height: targetHeight },
    width: targetWidth,
    height: targetHeight,
  };
};

/**
 * Run whatever links the plan asked for, in one chain and one save.
 *
 * `expectedWidth` / `expectedHeight` are only a fallback for a manipulator
 * that reports zeros; the result's own dimensions are preferred, because
 * downstream crops handed pre-resize numbers produce out-of-bounds boxes.
 *
 * On failure the original is returned rather than propagating. An oversized or
 * uncropped image is slow and slightly wider than the preview promised; a
 * capture that cannot complete is a reading the patient does not get to
 * record.
 */
const runChain = async (
  uri: string,
  width: number,
  height: number,
  crop: CoverCropBox | null,
  resize: ResizePlan | null,
): Promise<PreparedImage> => {
  if (!crop && !resize) return { uri, width, height };

  const expectedWidth = resize?.width ?? crop?.width ?? width;
  const expectedHeight = resize?.height ?? crop?.height ?? height;

  try {
    let context = ImageManipulator.manipulate(uri);
    if (crop) context = context.crop(crop);
    if (resize) context = context.resize(resize.axis);

    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      compress: COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
    });
    return {
      uri: result.uri,
      width: result.width || expectedWidth,
      height: result.height || expectedHeight,
    };
  } catch (error) {
    if (__DEV__) console.warn('[image-prepare] manipulation failed; keeping the original', error);
    return { uri, width, height };
  }
};

/**
 * Prepare a **live-camera** capture: crop to the viewport, then shrink.
 *
 * Dimensions come from the caller because both capture paths already report
 * them; `Image.getSize` has been observed to hang on a freshly written camera
 * URI on some Android devices, which stuck the capture UI.
 *
 * The resize is computed against the *cropped* size, not the photo's — the
 * crop happens first in the chain, so the cap and the floor apply to what
 * actually comes out.
 */
export const prepareCaptureForAnalysis = async (
  uri: string,
  photoWidth: number,
  photoHeight: number,
  viewportAspect: number,
): Promise<PreparedImage> => {
  const crop = computeCoverCropBox(photoWidth, photoHeight, viewportAspect);
  const resize = computeResizePlan(crop?.width ?? photoWidth, crop?.height ?? photoHeight);
  return runChain(uri, photoWidth, photoHeight, crop, resize);
};

/**
 * Prepare an image that was never bound to a preview — a gallery pick.
 *
 * Shrink only. There is no viewport to crop back to, and cropping would throw
 * away image area for nothing.
 */
export const prepareImageForAnalysis = async (
  uri: string,
  width: number,
  height: number,
): Promise<PreparedImage> => runChain(uri, width, height, null, computeResizePlan(width, height));
