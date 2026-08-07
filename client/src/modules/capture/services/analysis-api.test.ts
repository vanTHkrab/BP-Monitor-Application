/**
 * Upload → enqueue → poll, and the four ways it ends.
 *
 * This is the async half of the app: three round trips pretending to be one
 * call. The properties that matter from outside are the enqueue payload (a
 * literal `null` for `ocrEngine` is a 400 from the gateway's `@IsIn`, so it
 * must be *absent* in production), the `imageId` that has to survive out to the
 * caller or the offline drain re-uploads the same photo, and the three
 * terminal states — done, failed, timed out — plus cancellation.
 *
 * Fake timers throughout. `wait()` schedules a real 1.5s `setTimeout` per poll,
 * and a leaked one fires during whichever suite runs next.
 */
const mockRequest = jest.fn();
jest.mock('@/services/api', () => ({
  graphqlRequest: (...args: unknown[]) => mockRequest(...args),
}));

const mockUpload = jest.fn();
const mockMimeType = jest.fn();
jest.mock('@/services/upload-image', () => ({
  uploadImageViaPresign: (...args: unknown[]) => mockUpload(...args),
  mimeTypeForUri: (...args: unknown[]) => mockMimeType(...args),
}));

import { analyzeImage } from './analysis-api';

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 60_000;

const job = (over: Record<string, unknown> = {}) => ({
  jobId: 'job-1',
  status: 'pending',
  result: null,
  error: null,
  ...over,
});

const result = {
  readings: { systolic: 128, diastolic: 82, pulse: 71 },
  confidence: 0.94,
  roiImageUrl: 'https://s3.example/roi.png',
  rawText: '128/82 71',
  status: 'ok',
  engine: 'crnn',
  metrics: null,
};

const enqueueCall = () =>
  mockRequest.mock.calls.find((call) => (call[0] as string).includes('mutation AnalyzeBPImage'));
const pollCalls = () =>
  mockRequest.mock.calls.filter((call) => (call[0] as string).includes('query PollAnalysisJob'));

beforeEach(() => {
  jest.useFakeTimers();
  mockRequest.mockReset();
  mockUpload.mockReset();
  mockMimeType.mockReset();
  mockUpload.mockResolvedValue({
    key: 'bp/u1/2026/photo.jpg',
    url: 'https://s3.example/photo.jpg',
    imageId: 77,
  });
  mockMimeType.mockReturnValue('image/jpeg');
});

afterEach(() => {
  // Any interval still booked would fire inside the next test file and fail an
  // assertion whose stack points at this module.
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('the enqueue payload', () => {
  beforeEach(() => {
    mockRequest.mockResolvedValue({ analyzeBPImage: job({ status: 'done', result }) });
  });

  it('uploads under the BP kind before asking for any analysis', async () => {
    await analyzeImage('file:///tmp/photo.jpg');

    expect(mockUpload).toHaveBeenCalledWith({
      uri: 'file:///tmp/photo.jpg',
      kind: 'BLOOD_PRESSURE_READING',
    });
  });

  it('sends the key the upload returned and the mime type of the file', async () => {
    await analyzeImage('file:///tmp/photo.jpg');

    expect(enqueueCall()?.[1]).toEqual({
      input: { s3Key: 'bp/u1/2026/photo.jpg', mimeType: 'image/jpeg' },
    });
  });

  /*
   * The gateway validates `ocrEngine` with `@IsIn`, so a forwarded literal
   * null is a 400 rather than "use the default". Absent is the only shape
   * production may send, and a positive assertion on s3Key/mimeType would stay
   * green through a regression that added `ocrEngine: null`.
   */
  it('omits ocrEngine entirely rather than sending null in production', async () => {
    await analyzeImage('file:///tmp/photo.jpg');

    const input = (enqueueCall()?.[1] as { input: Record<string, unknown> }).input;
    expect(input).not.toHaveProperty('ocrEngine');
  });

  it('forwards the debug screen’s engine override when there is one', async () => {
    await analyzeImage('file:///tmp/photo.jpg', { ocrEngine: 'ssocr' });

    const input = (enqueueCall()?.[1] as { input: Record<string, unknown> }).input;
    expect(input.ocrEngine).toBe('ssocr');
  });
});

describe('a job the gateway answers immediately', () => {
  beforeEach(() => {
    mockRequest.mockResolvedValue({ analyzeBPImage: job({ status: 'done', result }) });
  });

  it('does not poll at all', async () => {
    await analyzeImage('file:///tmp/photo.jpg');

    expect(pollCalls()).toHaveLength(0);
  });

  it('returns the image id the caller must carry into createReading', async () => {
    const outcome = await analyzeImage('file:///tmp/photo.jpg');

    // Without this the offline drain uploads the same bytes a second time.
    expect(outcome.uploadedImageId).toBe(77);
    expect(outcome.uploadedUrl).toBe('https://s3.example/photo.jpg');
  });

  it('returns the parsed reading alongside the job', async () => {
    const outcome = await analyzeImage('file:///tmp/photo.jpg');

    expect(outcome.result?.readings).toEqual({ systolic: 128, diastolic: 82, pulse: 71 });
    expect(outcome.job.status).toBe('done');
  });

  it('reports a null result as null rather than undefined', async () => {
    mockRequest.mockResolvedValue({ analyzeBPImage: job({ status: 'done', result: null }) });

    const outcome = await analyzeImage('file:///tmp/photo.jpg');

    expect(outcome.result).toBeNull();
  });
});

describe('polling', () => {
  /** Enqueue answers `pending`, then the poll walks the given statuses. */
  const withPollSequence = (statuses: string[], finalOver: Record<string, unknown> = {}) => {
    let index = 0;
    mockRequest.mockImplementation((query: string) => {
      if (query.includes('mutation AnalyzeBPImage')) {
        return Promise.resolve({ analyzeBPImage: job({ status: 'pending' }) });
      }
      const status = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      const over = status === statuses.at(-1) ? finalOver : {};
      return Promise.resolve({ analysisJob: job({ status, ...over }) });
    });
  };

  /** Runs `analyzeImage` and drives the fake clock until it settles. */
  const runToCompletion = async (
    promise: Promise<unknown>,
    ticks: number,
  ): Promise<void> => {
    for (let tick = 0; tick < ticks; tick += 1) {
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    }
    await promise;
  };

  it('polls by job id until the job is done', async () => {
    withPollSequence(['processing', 'done'], { result });

    const promise = analyzeImage('file:///tmp/photo.jpg');
    await runToCompletion(promise, 3);

    expect(pollCalls()[0][1]).toEqual({ jobId: 'job-1' });
    await expect(promise).resolves.toMatchObject({ job: { status: 'done' } });
  });

  it('reports each status once, not once per poll', async () => {
    withPollSequence(['processing', 'processing', 'done'], { result });
    const onStatusChange = jest.fn();

    const promise = analyzeImage('file:///tmp/photo.jpg', { onStatusChange });
    await runToCompletion(promise, 4);

    // A callback that fired on every poll would drive a re-render every 1.5s
    // for the whole analysis.
    expect(onStatusChange.mock.calls.map((call) => call[0])).toEqual(['processing', 'done']);
  });

  it('surfaces the gateway’s own reason when the job fails', async () => {
    withPollSequence(['failed'], { error: 'ไม่พบตัวเลขบนหน้าจอ' });

    const promise = analyzeImage('file:///tmp/photo.jpg');
    const assertion = expect(promise).rejects.toThrow('ไม่พบตัวเลขบนหน้าจอ');
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await assertion;
  });

  it('falls back to a readable message when a failed job carries no reason', async () => {
    withPollSequence(['failed'], { error: null });

    const promise = analyzeImage('file:///tmp/photo.jpg');
    const assertion = expect(promise).rejects.toThrow('การวิเคราะห์ไม่สำเร็จ');
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await assertion;
  });

  it('gives up after the timeout instead of polling forever', async () => {
    withPollSequence(['processing']);

    const promise = analyzeImage('file:///tmp/photo.jpg');
    const assertion = expect(promise).rejects.toThrow('60 วินาที');
    // One extra interval past the deadline: the loop condition is checked
    // before each poll, so the last wait has to elapse for it to be seen.
    for (let tick = 0; tick < POLL_TIMEOUT_MS / POLL_INTERVAL_MS + 2; tick += 1) {
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    }
    await assertion;

    expect(pollCalls().length).toBeLessThanOrEqual(POLL_TIMEOUT_MS / POLL_INTERVAL_MS + 1);
  });
});

describe('cancellation', () => {
  it('stops polling the moment the caller aborts, without sitting out the interval', async () => {
    const controller = new AbortController();
    mockRequest.mockImplementation((query: string) =>
      query.includes('mutation AnalyzeBPImage')
        ? Promise.resolve({ analyzeBPImage: job({ status: 'pending' }) })
        : Promise.resolve({ analysisJob: job({ status: 'processing' }) }),
    );

    const promise = analyzeImage('file:///tmp/photo.jpg', { signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    // Let the first poll land, then abort while the interval is still running.
    await jest.advanceTimersByTimeAsync(0);
    const pollsBeforeAbort = pollCalls().length;
    controller.abort();
    await assertion;

    // No advance: an interruptible sleep must reject on the abort itself, not
    // when its timer would have fired.
    expect(pollCalls()).toHaveLength(pollsBeforeAbort);
  });

  it('passes the caller’s signal down to every request', async () => {
    const controller = new AbortController();
    mockRequest.mockResolvedValue({ analyzeBPImage: job({ status: 'done', result }) });

    await analyzeImage('file:///tmp/photo.jpg', { signal: controller.signal });

    expect(enqueueCall()?.[2]).toEqual({ signal: controller.signal });
  });
});
