
/**
 * JPEG file URI → letterboxed Float32Array tensor [1, 3, S, S] in RGB, [0, 1].
 *
 * Mirrors server/app/ai-service/src/ai_service/analyzer/preprocessing.py:letterbox
 * and yolo.py:_preprocess so the on-device tensor matches what the backend
 * model was trained on. The two paths must stay in sync — the model file is
 * shared verbatim.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

import { DEFAULT_INPUT_SIZE, type LetterboxPad } from './types';

export interface PreprocessResult {
  /** RGB float32, NCHW, normalized to [0, 1]. */
  tensor: Float32Array;
  /** Inverse letterbox info — used to map detections back to source coords. */
  pad: LetterboxPad;
  /** Source image pixel dimensions (pre-letterbox). */
  source: { width: number; height: number };
}

export interface PreprocessOptions {
  imageUri: string;
  /** Source pixel dims — pass from Camera.takePictureAsync / picker asset. */
  sourceWidth: number;
  sourceHeight: number;
  inputSize?: number;
}

/**
 * Preprocess an image file into a YOLO input tensor.
 *
 * Caller supplies source dims (the camera + picker already give them) so we
 * don't call ImageManipulator twice — Image.getSize has been observed to hang
 * on a just-written camera URI on some Android devices (see
 * utils/image-prepare.ts), which is the same reason `prepareImageForAnalysis`
 * also asks for explicit width/height.
 */
export async function preprocessImage(
  opts: PreprocessOptions,
): Promise<PreprocessResult> {
  const { imageUri, sourceWidth, sourceHeight, inputSize = DEFAULT_INPUT_SIZE } = opts;

  const scale = Math.min(inputSize / sourceWidth, inputSize / sourceHeight);
  const newW = Math.round(sourceWidth * scale);
  const newH = Math.round(sourceHeight * scale);

  // v14 contextual API — manipulateAsync is deprecated.
  const ref = await ImageManipulator.manipulate(imageUri)
    .resize({ width: newW, height: newH })
    .renderAsync();
  const resized = await ref.saveAsync({
    base64: true,
    compress: 1, // lossless re-encode — we're about to decode pixels back out
    format: SaveFormat.JPEG,
  });

  if (!resized.base64) {
    throw new Error('preprocessImage: ImageManipulator returned no base64');
  }

  // Decode JPEG bytes back to raw RGBA.
  const jpegBytes = base64ToUint8Array(resized.base64);
  const decoded = jpeg.decode(jpegBytes, { useTArray: true });

  // Letterbox-pad to inputSize x inputSize and write directly into a CHW
  // Float32Array. The tensor is zero-initialized so black padding is free.
  const padTop = Math.floor((inputSize - newH) / 2);
  const padLeft = Math.floor((inputSize - newW) / 2);

  const plane = inputSize * inputSize;
  const tensor = new Float32Array(3 * plane);

  const src = decoded.data;
  for (let y = 0; y < newH; y++) {
    const dstRow = (padTop + y) * inputSize + padLeft;
    const srcRow = y * newW * 4;
    for (let x = 0; x < newW; x++) {
      const sIdx = srcRow + x * 4;
      const dIdx = dstRow + x;
      tensor[dIdx] = src[sIdx] / 255;
      tensor[plane + dIdx] = src[sIdx + 1] / 255;
      tensor[2 * plane + dIdx] = src[sIdx + 2] / 255;
    }
  }

  return {
    tensor,
    pad: {
      top: padTop,
      bottom: inputSize - newH - padTop,
      left: padLeft,
      right: inputSize - newW - padLeft,
      scale,
    },
    source: { width: sourceWidth, height: sourceHeight },
  };
}

// expo-image-manipulator's base64 is the JPEG byte stream b64-encoded — no
// data URI prefix. atob is available in RN's Hermes runtime as of RN 0.81.
function base64ToUint8Array(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
