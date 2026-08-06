// /**
//  * End-to-end on-device YOLO detection: image URI → Detection[].
//  *
//  * Orchestrates session load, preprocess, inference, and postprocess so callers
//  * see a single async function. Higher-level pre-flight logic (which classes
//  * count as "monitor found", what to crop, what to warn about) lives in
//  * services/preflight-detection.service.ts — keep this file focused on the
//  * model wire.
//  */
// // import type { Tensor } from 'onnxruntime-react-native';

// import { postprocess } from './postprocess';
// import { preprocessImage, type PreprocessOptions } from './preprocess';
// import { getYoloSession } from './session';
// import {
//   DEFAULT_CONF_THRESHOLD,
//   DEFAULT_INPUT_SIZE,
//   DEFAULT_IOU_THRESHOLD,
//   type Detection,
// } from './types';

// // Lazy-resolve Tensor so the static import side effects (which call into the
// // native JSI installer) don't fire at module load — same reason as session.ts.
// let TensorCtor: typeof Tensor | null = null;
// function getTensor(): typeof Tensor {
//   if (TensorCtor) return TensorCtor;
//   // eslint-disable-next-line @typescript-eslint/no-require-imports
//   const ort = require('onnxruntime-react-native');
//   TensorCtor = ort.Tensor;
//   return TensorCtor!;
// }

// export interface DetectOptions extends PreprocessOptions {
//   confThreshold?: number;
//   iouThreshold?: number;
//   classFilter?: readonly number[];
// }

// export interface DetectResult {
//   detections: Detection[];
//   /** Per-stage timings in ms — useful for telemetry / dev overlay. */
//   metrics: {
//     preprocessMs: number;
//     inferenceMs: number;
//     postprocessMs: number;
//     totalMs: number;
//   };
//   source: { width: number; height: number };
// }

// export async function detectInImage(opts: DetectOptions): Promise<DetectResult> {
//   const t0 = Date.now();

//   const session = await getYoloSession();

//   const t1 = Date.now();
//   const { tensor, pad, source } = await preprocessImage({
//     imageUri: opts.imageUri,
//     sourceWidth: opts.sourceWidth,
//     sourceHeight: opts.sourceHeight,
//     inputSize: opts.inputSize ?? DEFAULT_INPUT_SIZE,
//   });
//   const t2 = Date.now();

//   const inputName = session.inputNames[0];
//   const outputName = session.outputNames[0];
//   const inputSize = opts.inputSize ?? DEFAULT_INPUT_SIZE;
//   const TensorImpl = getTensor();
//   const input = new TensorImpl('float32', tensor, [1, 3, inputSize, inputSize]);

//   const outputs = await session.run({ [inputName]: input });
//   const raw = outputs[outputName];
//   const t3 = Date.now();

//   const detections = postprocess({
//     rawOutput: raw.data as Float32Array,
//     outputDims: raw.dims,
//     pad,
//     source,
//     confThreshold: opts.confThreshold ?? DEFAULT_CONF_THRESHOLD,
//     iouThreshold: opts.iouThreshold ?? DEFAULT_IOU_THRESHOLD,
//     classFilter: opts.classFilter,
//   });
//   const t4 = Date.now();

//   return {
//     detections,
//     metrics: {
//       preprocessMs: t2 - t1,
//       inferenceMs: t3 - t2,
//       postprocessMs: t4 - t3,
//       totalMs: t4 - t0,
//     },
//     source,
//   };
// }
