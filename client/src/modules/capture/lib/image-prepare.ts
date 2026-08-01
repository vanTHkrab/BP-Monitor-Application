/**
 * Shrink a capture before it goes anywhere.
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

const MAX_LONG_EDGE_PX = 1600;
const MIN_SHORT_EDGE_PX = 512;

/** Below ~0.6 the smaller pulse digits start to smear. */
const COMPRESS_QUALITY = 0.7;

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Returns the resized URI **and** its real dimensions, because downstream
 * crops that are handed pre-resize numbers produce out-of-bounds boxes.
 *
 * Dimensions come from the caller — see the note in `crop-to-viewport.ts`
 * about `Image.getSize` hanging on fresh camera URIs.
 *
 * On failure the original is returned: an oversized upload is slow, a blocked
 * capture is broken.
 */
export const prepareImageForAnalysis = async (
  uri: string,
  width: number,
  height: number,
): Promise<PreparedImage> => {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);

  // Already inside both bounds — skip the re-encode entirely.
  if (longEdge <= MAX_LONG_EDGE_PX && shortEdge >= MIN_SHORT_EDGE_PX) {
    return { uri, width, height };
  }

  // The floor wins when the two disagree, so it is resolved first.
  const scale =
    shortEdge < MIN_SHORT_EDGE_PX
      ? MIN_SHORT_EDGE_PX / shortEdge
      : MAX_LONG_EDGE_PX / longEdge;

  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  try {
    // Only one axis is specified so the manipulator preserves the aspect
    // ratio itself rather than trusting two independently rounded numbers.
    const rendered = await ImageManipulator.manipulate(uri)
      .resize(width >= height ? { width: targetWidth } : { height: targetHeight })
      .renderAsync();
    const result = await rendered.saveAsync({
      compress: COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
    });
    return {
      uri: result.uri,
      width: result.width || targetWidth,
      height: result.height || targetHeight,
    };
  } catch (error) {
    if (__DEV__) console.warn('[image-prepare] resize failed; keeping the original', error);
    return { uri, width, height };
  }
};
