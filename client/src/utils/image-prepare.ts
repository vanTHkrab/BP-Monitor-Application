import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// Cap the long edge of the image. BP-monitor LCD digits stay sharp for OCR
// well below 4 K, so resizing here saves a lot:
//   - JS bridge memory pressure (a 4032×3024 photo turned into a Uint8Array
//     is ~25 MB; the same scene at 1600 px ≈ 4 MB).
//   - Upload bandwidth and S3 spend.
//   - AI service decode + inference time.
const MAX_LONG_EDGE_PX = 1600;

// JPEG re-compression on top of whatever the source already used. Anything
// below ~0.6 starts losing legibility on the smaller fonts (pulse digits);
// 0.7 is a comfortable balance.
const COMPRESS_QUALITY = 0.7;

/**
 * Resize + recompress an image to a sane size before handing it off to the
 * AI analysis pipeline. Skips the work entirely when the source is already
 * small enough so we don't upscale tiny inputs (and waste a JPEG re-encode
 * pass).
 *
 * Dimensions are taken from the caller (both `Camera.takePictureAsync` and
 * `ImagePicker.launchImageLibraryAsync` return `width` / `height` on the
 * asset already) — we never call `Image.getSize`, which has been observed
 * to hang on a just-written camera URI on some Android devices and was
 * leaving the capture UI stuck.
 *
 * On any failure we return the original URI so the rest of the flow keeps
 * working with the un-resized image rather than blocking on the resize.
 */
export const prepareImageForAnalysis = async (
  uri: string,
  width: number,
  height: number,
): Promise<string> => {
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_LONG_EDGE_PX) return uri;

  // Lock the *long* edge so portrait and landscape images both shrink to
  // the same target; aspect ratio is preserved automatically.
  const resize =
    width >= height
      ? { width: MAX_LONG_EDGE_PX }
      : { height: MAX_LONG_EDGE_PX };

  try {
    // v14 contextual API — `manipulateAsync` is deprecated.
    const ref = await ImageManipulator.manipulate(uri).resize(resize).renderAsync();
    const result = await ref.saveAsync({
      compress: COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
    });
    return result.uri;
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[image-prepare] resize failed, falling back to original URI",
        error,
      );
    }
    return uri;
  }
};
