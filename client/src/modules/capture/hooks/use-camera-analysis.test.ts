/**
 * The capture state machine: photo → numbers → saved reading.
 *
 * The design constraint is stated at the top of the hook and is the thing
 * worth protecting: **nothing here can block a save.** Every failure — no
 * network, no detector, an unreadable display, a cancelled request — has to
 * resolve to "the form is empty, type the numbers" rather than to an error the
 * screen must handle. Most of this file is that property, once per failure
 * mode.
 *
 * The other half is `save`'s payload. `measuredAt` is the *capture* time, not
 * the save time, and `imageId` is what stops the outbox drain re-uploading
 * bytes S3 already has. Neither is visible in a type — `createReading` takes
 * both as ordinary optional fields — so both are asserted on the whole object
 * rather than field by field, which also fails if a field nobody intended
 * starts being sent.
 *
 * Mocked at the two service boundaries the hook actually imports. It does not
 * touch `bp-vision` or `expo-camera` directly: the native call sits behind
 * `lib/ocr/read`, and the upload-and-poll loop behind `services/analysis-api`
 * (whose own suite owns the polling). Replacing those two means this file
 * never opens a timer, which is why it needs no fake clock.
 */
const mockReadBpFromImage = jest.fn();
jest.mock('../lib/ocr/read', () => ({
  readBpFromImage: (...args: unknown[]) => mockReadBpFromImage(...args),
}));

const mockAnalyzeImage = jest.fn();
jest.mock('../services/analysis-api', () => ({
  analyzeImage: (...args: unknown[]) => mockAnalyzeImage(...args),
}));

const mockCreateReading = jest.fn();
const mockReadings = { isSaving: false };
jest.mock('@/modules/readings', () => ({
  useCreateReading: () => ({
    createReading: (...args: unknown[]) => mockCreateReading(...args),
    // A getter, not a captured value: the factory is hoisted above the
    // `mockReadings` declaration, so reading it eagerly would freeze
    // `undefined` in place forever.
    get isSaving() {
      return mockReadings.isSaving;
    },
  }),
}));

import { act, renderHook } from '@testing-library/react-native';

import type { AnalysisJobStatus } from '../types';
import { useCameraAnalysis } from './use-camera-analysis';

const IMAGE_URI = 'file:///cache/capture-1.jpg';

/** The capture time, deliberately far from "now" — see the `save` block. */
const MEASURED_AT = new Date('2026-02-01T09:00:00.000Z');

const READINGS = { systolic: 128, diastolic: 82, pulse: 71 };

const analysisResult = (confidence: number, readings: typeof READINGS | null = READINGS) => ({
  readings,
  confidence,
  roiImageUrl: null,
  rawText: null,
  status: 'success' as const,
  engine: null,
  metrics: null,
});

const outcome = (confidence: number, uploadedImageId: number | null = 42) => ({
  job: { jobId: 'job-1', status: 'done' as const },
  result: analysisResult(confidence),
  uploadedUrl: 'https://s3.example/bp/capture-1.jpg',
  uploadedImageId,
});

const abortError = () => {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
};

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` clears recorded calls but not implementations, so an
  // implementation one test installs would otherwise leak into every test
  // after it.
  mockReadBpFromImage.mockReset();
  mockAnalyzeImage.mockReset();
  mockCreateReading.mockReset();

  mockReadBpFromImage.mockResolvedValue({ unavailable: true, reason: 'no-module' });
  mockAnalyzeImage.mockResolvedValue(outcome(0.9));
  mockCreateReading.mockResolvedValue('reading-1');
  mockReadings.isSaving = false;
});

describe('the resting state', () => {
  it('starts idle with nothing to show', async () => {
    const view = await renderHook(() => useCameraAnalysis());

    expect(view.result.current.phase).toBe('idle');
    expect(view.result.current.result).toBeNull();
    expect(view.result.current.job).toBeNull();
    expect(view.result.current.uploadedImageId).toBeNull();
    expect(view.result.current.lowConfidence).toBe(false);
    expect(view.result.current.error).toBeNull();
  });
});

describe('reading on this device', () => {
  it('hands back the numbers and marks them confident', async () => {
    mockReadBpFromImage.mockResolvedValue({ sys: 128, dia: 82, pulse: 71, confidence: 0.8 });

    const view = await renderHook(() => useCameraAnalysis());
    let read;
    await act(async () => {
      read = await view.result.current.readOnDevice(IMAGE_URI);
    });

    // Returned, not pushed into a `prefill` field the screen watches: the
    // caller fills the form inside the handler that awaited this.
    expect(read).toEqual({ readings: READINGS, confident: true });
    expect(view.result.current.phase).toBe('done');
    expect(view.result.current.lowConfidence).toBe(false);
    expect(view.result.current.result?.status).toBe('success');
  });

  it('asks the user to check numbers it is not sure about', async () => {
    mockReadBpFromImage.mockResolvedValue({ sys: 128, dia: 82, pulse: 71, confidence: 0.49 });

    const view = await renderHook(() => useCameraAnalysis());
    let read;
    await act(async () => {
      read = await view.result.current.readOnDevice(IMAGE_URI);
    });

    // The numbers still come back — the asymmetry is deliberate. A wrong
    // number nobody noticed becomes a wrong number in a medical history; a
    // confirmation costs a tap.
    expect(read).toEqual({ readings: READINGS, confident: false });
    expect(view.result.current.lowConfidence).toBe(true);
    expect(view.result.current.result?.status).toBe('low_confidence');
  });

  it('treats the threshold itself as confident', async () => {
    // Boundary, and it is the same 0.5 both engines are held to — "the app
    // was sure" has to mean one thing whichever path produced the numbers.
    mockReadBpFromImage.mockResolvedValue({ sys: 128, dia: 82, pulse: 71, confidence: 0.5 });

    const view = await renderHook(() => useCameraAnalysis());
    let read;
    await act(async () => {
      read = await view.result.current.readOnDevice(IMAGE_URI);
    });

    expect(read).toEqual({ readings: READINGS, confident: true });
    expect(view.result.current.lowConfidence).toBe(false);
  });

  it('falls through to manual entry when there is no detector', async () => {
    mockReadBpFromImage.mockResolvedValue({ unavailable: true, reason: 'model-load-failed' });

    const view = await renderHook(() => useCameraAnalysis());
    let read;
    await act(async () => {
      read = await view.result.current.readOnDevice(IMAGE_URI);
    });

    // `null`, and crucially *not* an error: an unavailable OCR is a missing
    // optimisation, not a failure the patient has to acknowledge.
    expect(read).toBeNull();
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.result).toBeNull();
    // Back to idle, or the preview chip sits on "กำลังอ่านค่าในเครื่อง..."
    // forever after we have given up.
    expect(view.result.current.phase).toBe('idle');
  });

  it('reports the reading phase while the on-device pass runs', async () => {
    let settle: (value: unknown) => void = () => {};
    mockReadBpFromImage.mockImplementation(() => new Promise((r) => (settle = r)));

    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      void view.result.current.readOnDevice(IMAGE_URI);
    });

    expect(view.result.current.phase).toBe('reading');

    await act(async () => {
      settle({ unavailable: true, reason: 'no-module' });
    });
  });
});

describe('reading through the backend', () => {
  it('sends no ocrEngine at all unless one was asked for', async () => {
    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
    });

    const [uri, options] = mockAnalyzeImage.mock.calls[0];
    expect(uri).toBe(IMAGE_URI);
    // The gateway validates `ocrEngine` with `@IsIn`, so a forwarded literal
    // null is a 400 — "absent" and "null" are different requests. A positive
    // assertion on the other fields would pass just as happily with a null
    // in there, so the key set is what gets asserted.
    expect('ocrEngine' in options).toBe(false);
    expect(Object.keys(options).sort()).toEqual(['onStatusChange', 'signal']);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('forwards the debug screen’s engine override when there is one', async () => {
    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI, { ocrEngine: 'ssocr' });
    });

    expect(mockAnalyzeImage.mock.calls[0][1].ocrEngine).toBe('ssocr');
  });

  it('translates every job status into the phase the chip renders', async () => {
    // The status callback is driven from the test rather than from inside the
    // mock, because `result.current` is the last *committed* render: sampling
    // it between two synchronous `onStatusChange` calls reads the render from
    // before `analyze` was even called, and every phase looks like `idle`.
    let emit: (status: AnalysisJobStatus) => void = () => {};
    let settle: (value: unknown) => void = () => {};
    mockAnalyzeImage.mockImplementation(
      async (_uri: string, options: { onStatusChange: (s: AnalysisJobStatus) => void }) => {
        emit = options.onStatusChange;
        return new Promise((resolve) => (settle = resolve));
      },
    );

    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      void view.result.current.analyze(IMAGE_URI);
    });

    // Before the job exists at all the user is watching an upload.
    expect(view.result.current.phase).toBe('uploading');

    // `pending` reads as "waiting for the AI", not "pending" — the chip copy
    // is the only thing telling the user whether anything is happening.
    await act(async () => emit('pending'));
    expect(view.result.current.phase).toBe('queued');

    await act(async () => emit('processing'));
    expect(view.result.current.phase).toBe('processing');

    await act(async () => emit('failed'));
    expect(view.result.current.phase).toBe('failed');

    // A resolved job overrides whatever the last status said — the poll loop
    // reporting `failed` for one tick must not strand the screen there.
    await act(async () => {
      settle(outcome(0.9));
    });
    expect(view.result.current.phase).toBe('done');
  });

  it('carries the uploaded image id out of the analysis', async () => {
    mockAnalyzeImage.mockResolvedValue(outcome(0.9, 77));

    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
    });

    expect(view.result.current.uploadedImageId).toBe(77);
    expect(view.result.current.phase).toBe('done');
  });

  it('flags a low-confidence server read without withholding the numbers', async () => {
    mockAnalyzeImage.mockResolvedValue(outcome(0.4));

    const view = await renderHook(() => useCameraAnalysis());
    let read;
    await act(async () => {
      read = await view.result.current.analyze(IMAGE_URI);
    });

    expect(read).toEqual({ readings: READINGS, confident: false });
    expect(view.result.current.lowConfidence).toBe(true);
  });

  it('reports no prefill when the server read nothing off the display', async () => {
    mockAnalyzeImage.mockResolvedValue({
      job: { jobId: 'job-1', status: 'done' as const },
      result: { ...analysisResult(0.9, null), status: 'unreadable' as const },
      uploadedUrl: 'https://s3.example/bp/capture-1.jpg',
      uploadedImageId: 42,
    });

    const view = await renderHook(() => useCameraAnalysis());
    let read;
    await act(async () => {
      read = await view.result.current.analyze(IMAGE_URI);
    });

    expect(read).toBeNull();
    // An unreadable photo is still an uploaded photo, and the id has to
    // survive or the drain uploads the same bytes a second time.
    expect(view.result.current.uploadedImageId).toBe(42);
    expect(view.result.current.lowConfidence).toBe(false);
    expect(view.result.current.error).toBeNull();
  });

  it('surfaces a transport failure as a message, never as a thrown error', async () => {
    mockAnalyzeImage.mockRejectedValue(new Error('เครือข่ายขัดข้อง'));

    const view = await renderHook(() => useCameraAnalysis());
    let read;
    await act(async () => {
      // Not `rejects` — the screen awaits this inline while filling a form,
      // and a throw here would take the capture screen down with it.
      read = await view.result.current.analyze(IMAGE_URI);
    });

    expect(read).toBeNull();
    expect(view.result.current.phase).toBe('failed');
    expect(view.result.current.error).toBe('เครือข่ายขัดข้อง');
  });

  it('falls back to Thai copy when the failure carries no message', async () => {
    mockAnalyzeImage.mockRejectedValue('a string, not an Error');

    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
    });

    // Reaches the user, so it is Thai by design — an empty error banner is
    // worse than a generic one.
    expect(view.result.current.error).toBe('วิเคราะห์ไม่สำเร็จ');
  });

  it('clears state left by a previous attempt when a new one starts', async () => {
    mockAnalyzeImage.mockRejectedValueOnce(new Error('เครือข่ายขัดข้อง'));

    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
    });
    expect(view.result.current.error).toBe('เครือข่ายขัดข้อง');

    mockAnalyzeImage.mockResolvedValue(outcome(0.9));
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
    });

    // A retry that inherits the previous error shows a failure banner over a
    // successful read.
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.phase).toBe('done');
  });
});

describe('cancelling an analysis', () => {
  it('aborts the in-flight request when a second one starts', async () => {
    const signals: AbortSignal[] = [];
    mockAnalyzeImage.mockImplementation(async (_uri: string, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return outcome(0.9);
    });

    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
      await view.result.current.analyze('file:///cache/capture-2.jpg');
    });

    // A retake must not leave the first photo's poll loop running against a
    // job whose answer would arrive and overwrite the second one's.
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('leaves a cancelled analysis idle rather than failed', async () => {
    mockAnalyzeImage.mockRejectedValue(abortError());

    const view = await renderHook(() => useCameraAnalysis());
    let read;
    await act(async () => {
      const pending = view.result.current.analyze(IMAGE_URI);
      view.result.current.reset();
      read = await pending;
    });

    expect(read).toBeNull();
    // A cancelled analysis is the user moving on, not a failure to report.
    // Reporting it would put an error banner on a screen the user just
    // deliberately reset.
    expect(view.result.current.phase).toBe('idle');
    expect(view.result.current.error).toBeNull();
  });

  it('clears the carried image id on reset', async () => {
    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
    });
    expect(view.result.current.uploadedImageId).toBe(42);

    await act(async () => {
      view.result.current.reset();
    });

    // A retake photographs different bytes. Carrying the old id into the save
    // would attach the previous photo to the new reading.
    expect(view.result.current.uploadedImageId).toBeNull();
    expect(view.result.current.result).toBeNull();
    expect(view.result.current.lowConfidence).toBe(false);
  });
});

describe('the low-confidence banner', () => {
  it('dismisses the flag but keeps the numbers the screen may still fill', async () => {
    mockAnalyzeImage.mockResolvedValue(outcome(0.3));

    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
    });

    await act(async () => {
      view.result.current.dismissLowConfidence();
    });

    expect(view.result.current.lowConfidence).toBe(false);
    // Only the flag lives in the hook. Whether the values reach the form is
    // the screen's call, so `result.readings` has to survive the dismissal
    // either way the user answered.
    expect(view.result.current.result?.readings).toEqual(READINGS);
  });
});

describe('saving', () => {
  it('sends the capture time and the uploaded image id, and nothing else', async () => {
    mockAnalyzeImage.mockResolvedValue(outcome(0.9, 77));

    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
    });

    let id;
    await act(async () => {
      id = await view.result.current.save({
        imageUri: IMAGE_URI,
        measuredAt: MEASURED_AT,
        ...READINGS,
      });
    });

    expect(id).toBe('reading-1');
    // The whole object, not field-by-field. `measuredAt` is the *capture*
    // time — an offline capture saved an hour later must keep the moment the
    // measurement was actually taken — and `imageId` is what stops the outbox
    // drain uploading bytes S3 already holds. Deep equality also fails if a
    // field nobody intended starts being sent.
    expect(mockCreateReading).toHaveBeenCalledWith({
      systolic: 128,
      diastolic: 82,
      pulse: 71,
      measuredAt: MEASURED_AT,
      imageUri: IMAGE_URI,
      imageId: 77,
      patientId: undefined,
    });
  });

  it('omits the image id entirely when the photo was never uploaded', async () => {
    // The offline path. `imageId: null` would be a different request from
    // "no imageId", and the drain has to be told to upload these bytes.
    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.save({
        imageUri: IMAGE_URI,
        measuredAt: MEASURED_AT,
        ...READINGS,
      });
    });

    expect(mockCreateReading.mock.calls[0][0].imageId).toBeUndefined();
  });

  it('routes a caregiver’s save to the patient they are recording for', async () => {
    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.save({
        imageUri: IMAGE_URI,
        measuredAt: MEASURED_AT,
        patientId: 'p9',
        ...READINGS,
      });
    });

    // Without this the reading lands in the caregiver's own history and the
    // patient's chart silently misses a measurement.
    expect(mockCreateReading.mock.calls[0][0].patientId).toBe('p9');
  });

  it('passes the queue’s saving flag straight through to the button', async () => {
    mockReadings.isSaving = true;

    const view = await renderHook(() => useCameraAnalysis());

    // The save button disables on this; a hook that owned its own flag would
    // re-enable while the durable write was still in flight.
    expect(view.result.current.isSaving).toBe(true);
  });

  it('saves after a failed analysis, because a failure must never block one', async () => {
    mockAnalyzeImage.mockRejectedValue(new Error('เครือข่ายขัดข้อง'));

    const view = await renderHook(() => useCameraAnalysis());
    await act(async () => {
      await view.result.current.analyze(IMAGE_URI);
    });
    expect(view.result.current.phase).toBe('failed');

    let id;
    await act(async () => {
      id = await view.result.current.save({
        imageUri: IMAGE_URI,
        measuredAt: MEASURED_AT,
        ...READINGS,
      });
    });

    // The patient came to record a measurement. Reading assistance is an
    // optimisation on top of that, and a failed one cannot cost them the row.
    expect(id).toBe('reading-1');
    expect(mockCreateReading.mock.calls[0][0].imageId).toBeUndefined();
  });
});
