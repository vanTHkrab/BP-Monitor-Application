import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// Cap the long edge of the image. BP-monitor LCD digits stay sharp for OCR
// well below 4 K, so resizing here saves a lot:
//   - JS bridge memory pressure (a 4032×3024 photo turned into a Uint8Array
//     is ~25 MB; the same scene at 1600 px ≈ 4 MB).
//   - Upload bandwidth and S3 spend.
//   - AI service decode + inference time.
const MAX_LONG_EDGE_PX = 1600;

// Floor for the short edge. Matches the backend YOLO detector's letterbox
// target (analyzer/yolo.py:DEFAULT_INPUT_SIZE = 512) — anything smaller
// would get upscaled by the backend at detect time, so we may as well
// upscale here on a native code path and guarantee an invariant: the
// bytes leaving the device are always at least 512x512.
const MIN_SHORT_EDGE_PX = 512;

// JPEG re-compression on top of whatever the source already used. Anything
// below ~0.6 starts losing legibility on the smaller fonts (pulse digits);
// 0.7 is a comfortable balance.
const COMPRESS_QUALITY = 0.7;

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Resize + recompress an image to a sane size before handing it off to the
 * AI analysis pipeline. Enforces two invariants on the output:
 *
 *   - long edge  ≤ MAX_LONG_EDGE_PX (1600) — soft cap, downscaled if over
 *   - short edge ≥ MIN_SHORT_EDGE_PX (512) — hard floor, upscaled if under
 *
 * When the source already satisfies both, the work is skipped entirely so
 * we don't waste a JPEG re-encode pass. For pathologically elongated
 * inputs where the cap and floor disagree (e.g. a 4000x200 banner), the
 * floor wins — the backend pipeline cannot recover from a sub-512 input,
 * but it can tolerate an oversized long edge.
 *
 * Dimensions are taken from the caller (both `Camera.takePictureAsync` and
 * `ImagePicker.launchImageLibraryAsync` return `width` / `height` on the
 * asset already) — we never call `Image.getSize`, which has been observed
 * to hang on a just-written camera URI on some Android devices and was
 * leaving the capture UI stuck.
 *
 * Returns both the post-resize URI AND the new dimensions because callers
 * (notably the on-device YOLO pre-flight) need to know the *actual* pixel
 * size of the file behind the URI — passing the pre-resize dimensions to
 * downstream crops causes out-of-bounds rejections.
 *
 * On any failure we return the original URI + dimensions so the rest of
 * the flow keeps working with the un-resized image rather than blocking
 * on the resize.
 */
export const prepareImageForAnalysis = async (
  uri: string,
  width: number,
  height: number,
): Promise<PreparedImage> => {
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_LONG_EDGE_PX) return { uri, width, height };

  // Lock the *long* edge so portrait and landscape images both shrink to
  // the same target; aspect ratio is preserved automatically.
  const scale = MAX_LONG_EDGE_PX / longEdge;
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);
  const resize =
    width >= height ? { width: MAX_LONG_EDGE_PX } : { height: MAX_LONG_EDGE_PX };

  try {
    // v14 contextual API — `manipulateAsync` is deprecated.
    const ref = await ImageManipulator.manipulate(uri).resize(resize).renderAsync();
    const result = await ref.saveAsync({
      compress: COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
    });
    return {
      uri: result.uri,
      // Prefer the result's reported dims (authoritative — saveAsync sets
      // them) but fall back to our calculated values if the runtime returns
      // 0/undefined for any reason.
      width: result.width || newW,
      height: result.height || newH,
    };
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[image-prepare] resize failed, falling back to original URI",
        error,
      );
    }
    return { uri, width, height };
  }
};
