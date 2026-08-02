import {
  IMAGE_ATTEMPT_LIMIT,
  LocalImageMissing,
  drainQueue,
  resetSyncMutex,
  runSync,
  type SyncPorts,
} from './sync';
import type { Reading } from '../types';
import type { PendingReading } from '@/database/schema';

const USER = 'user-1';

const queuedRow = (over: Partial<PendingReading> = {}): PendingReading => ({
  clientId: 'c1',
  userId: USER,
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: '2026-07-29T08:00:00.000Z',
  status: 'elevated',
  notes: null,
  imageUri: null,
  imageId: null,
  recordedById: null,
  recordedByName: null,
  createdAt: '2026-07-29T08:00:01.000Z',
  attempts: 0,
  lastError: null,
  ...over,
});

const created = (over: Partial<Reading> = {}): Reading => ({
  key: 'client:c1',
  remoteId: 500,
  clientId: 'c1',
  userId: USER,
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: new Date('2026-07-29T08:00:00.000Z'),
  status: 'elevated',
  createdAt: new Date('2026-07-29T08:00:02.000Z'),
  syncState: 'synced',
  ...over,
});

function makePorts(over: Partial<SyncPorts> = {}) {
  const ports: jest.Mocked<Required<Omit<SyncPorts, 'now'>>> & Pick<SyncPorts, 'now'> = {
    listQueued: jest.fn(async () => [queuedRow()]),
    uploadImage: jest.fn(async () => 99),
    createReading: jest.fn(async () => created()),
    promote: jest.fn(async () => {}),
    recordImageUploaded: jest.fn(async () => {}),
    recordFailure: jest.fn(async () => {}),
    releaseImage: jest.fn(async () => {}),
    now: () => new Date('2026-07-29T10:00:00.000Z'),
    ...over,
  } as never;

  return ports;
}

beforeEach(() => resetSyncMutex());

describe('drainQueue', () => {
  it('creates the reading and promotes it into the mirror', async () => {
    const ports = makePorts();

    const result = await drainQueue(ports, USER);

    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(ports.promote).toHaveBeenCalledWith('c1', expect.objectContaining({ remoteId: 500 }));
  });

  // Rule 2. This is the only thing between an interrupted sync and two
  // identical readings in someone's medical history.
  it('sends the queued clientId, never a fresh one', async () => {
    const ports = makePorts({ listQueued: jest.fn(async () => [queuedRow({ clientId: 'c-original' })]) });

    await drainQueue(ports, USER);

    expect(ports.createReading).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c-original' }),
    );
  });

  it('sends the same clientId again on a retry', async () => {
    const row = queuedRow({ clientId: 'c-original', attempts: 2 });
    const ports = makePorts({ listQueued: jest.fn(async () => [row]) });

    await drainQueue(ports, USER);

    expect(ports.createReading).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c-original' }),
    );
  });

  // A caregiver's offline capture is the case this protects. The queue row
  // knows whose reading it is, but only through two fields — drop the
  // translation and the reading lands in the caregiver's own history, which
  // nobody would notice until a clinician read the wrong chart.
  describe('on-behalf attribution', () => {
    it('sends the patient id when someone else recorded the reading', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [
          queuedRow({ userId: 'patient-9', recordedById: 'caregiver-1' }),
        ]),
      });

      await drainQueue(ports, USER);

      expect(ports.createReading).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: 'patient-9' }),
      );
    });

    it('sends no patient id for a reading someone recorded for themselves', async () => {
      const ports = makePorts();

      await drainQueue(ports, USER);

      expect(ports.createReading).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: null }),
      );
    });
  });

  describe('photos', () => {
    it('uploads a local photo and attaches the resulting image id', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [queuedRow({ imageUri: 'file:///tmp/a.jpg' })]),
      });

      await drainQueue(ports, USER);

      expect(ports.uploadImage).toHaveBeenCalledWith('file:///tmp/a.jpg');
      expect(ports.createReading).toHaveBeenCalledWith(expect.objectContaining({ imageId: 99 }));
    });

    // Rule 3. Uploading again mints a second Image row and orphans the first
    // object in the bucket.
    it('does not re-upload when a previous pass already confirmed one', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [
          queuedRow({ imageUri: 'file:///tmp/a.jpg', imageId: 42 }),
        ]),
      });

      await drainQueue(ports, USER);

      expect(ports.uploadImage).not.toHaveBeenCalled();
      expect(ports.createReading).toHaveBeenCalledWith(expect.objectContaining({ imageId: 42 }));
    });

    it('records the upload before the create, so a crash between them resumes', async () => {
      const order: string[] = [];
      const ports = makePorts({
        listQueued: jest.fn(async () => [queuedRow({ imageUri: 'file:///tmp/a.jpg' })]),
        recordImageUploaded: jest.fn(async () => {
          order.push('recorded');
        }),
        createReading: jest.fn(async () => {
          order.push('created');
          return created();
        }),
      });

      await drainQueue(ports, USER);

      expect(order).toEqual(['recorded', 'created']);
    });

    // Rule 4. The OS can evict the cache file before the user reconnects.
    // Losing the picture is bad; refusing to sync the numbers is worse.
    it('syncs the numbers when the local photo has been evicted', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [queuedRow({ imageUri: 'file:///tmp/gone.jpg' })]),
        uploadImage: jest.fn(async () => {
          throw new LocalImageMissing('file:///tmp/gone.jpg');
        }),
      });

      const result = await drainQueue(ports, USER);

      expect(result.synced).toBe(1);
      expect(ports.createReading).toHaveBeenCalledWith(expect.objectContaining({ imageId: null }));
    });

    it('fails the whole row while the upload still has retries left', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [queuedRow({ imageUri: 'file:///tmp/a.jpg' })]),
        uploadImage: jest.fn(async () => {
          throw new Error('network down');
        }),
      });

      const result = await drainQueue(ports, USER);

      expect(result).toEqual({ synced: 0, failed: 1 });
      expect(ports.createReading).not.toHaveBeenCalled();
    });

    // The bug this budget exists for: one photo that could never be uploaded
    // — an expired presign, a bucket 5xx, a file the OS re-encoded — kept a
    // blood-pressure reading out of the patient's record permanently, and
    // every reading taken with the camera has a photo.
    it('sends the numbers without the photo once the retry budget is spent', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [
          queuedRow({ imageUri: 'file:///tmp/a.jpg', attempts: IMAGE_ATTEMPT_LIMIT - 1 }),
        ]),
        uploadImage: jest.fn(async () => {
          throw new Error('S3 PUT failed with 500');
        }),
      });

      const result = await drainQueue(ports, USER);

      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(ports.createReading).toHaveBeenCalledWith(
        expect.objectContaining({ imageId: null }),
      );
    });

    it('keeps the durable copy when the photo never reached the server', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [
          queuedRow({ imageUri: 'file:///tmp/a.jpg', attempts: IMAGE_ATTEMPT_LIMIT - 1 }),
        ]),
        uploadImage: jest.fn(async () => {
          throw new Error('S3 PUT failed with 500');
        }),
      });

      await drainQueue(ports, USER);

      // That file is now the only copy of the photo in existence. Releasing
      // it here — or sweeping it at the next launch — takes a picture away
      // from a patient to reclaim a few kilobytes.
      expect(ports.releaseImage).not.toHaveBeenCalled();
      expect(ports.promote).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ imageUri: 'file:///tmp/a.jpg' }),
      );
    });

    it('keeps the local photo path on the promoted row', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [queuedRow({ imageUri: 'file:///tmp/a.jpg' })]),
      });

      await drainQueue(ports, USER);

      expect(ports.promote).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ imageUri: 'file:///tmp/a.jpg' }),
      );
    });

    it('releases the durable copy only after the row is promoted', async () => {
      const order: string[] = [];
      const ports = makePorts({
        promote: jest.fn(async () => {
          order.push('promoted');
        }),
        releaseImage: jest.fn(async () => {
          order.push('released');
        }),
      });

      await drainQueue(ports, USER);

      expect(order).toEqual(['promoted', 'released']);
    });

    it('still counts the row as synced when releasing the copy fails', async () => {
      const ports = makePorts({
        releaseImage: jest.fn(async () => {
          throw new Error('unlink failed');
        }),
      });

      await expect(drainQueue(ports, USER)).resolves.toEqual({ synced: 1, failed: 0 });
    });
  });

  describe('failures', () => {
    // Rule 5. One poison reading must not block every measurement behind it.
    it('continues past a failing row', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [
          queuedRow({ clientId: 'bad' }),
          queuedRow({ clientId: 'good' }),
        ]),
        createReading: jest
          .fn()
          .mockRejectedValueOnce(new Error('rejected'))
          .mockResolvedValueOnce(created({ clientId: 'good' })),
      });

      const result = await drainQueue(ports, USER);

      expect(result).toEqual({ synced: 1, failed: 1 });
      expect(ports.promote).toHaveBeenCalledTimes(1);
    });

    it('increments attempts and records the message on the row', async () => {
      const ports = makePorts({
        listQueued: jest.fn(async () => [queuedRow({ attempts: 2 })]),
        createReading: jest.fn(async () => {
          throw new Error('gateway said no');
        }),
      });

      await drainQueue(ports, USER);

      expect(ports.recordFailure).toHaveBeenCalledWith('c1', 3, 'gateway said no');
    });

    // A rejecting drain would take down whatever triggered it — an
    // app-foreground handler, a NetInfo edge — for an expected failure.
    it('never rejects', async () => {
      const ports = makePorts({
        createReading: jest.fn(async () => {
          throw new Error('boom');
        }),
      });

      await expect(drainQueue(ports, USER)).resolves.toBeDefined();
    });

    it('does not promote a row whose create failed', async () => {
      const ports = makePorts({
        createReading: jest.fn(async () => {
          throw new Error('boom');
        }),
      });

      await drainQueue(ports, USER);

      expect(ports.promote).not.toHaveBeenCalled();
    });
  });

  it('is a no-op on an empty queue', async () => {
    const ports = makePorts({ listQueued: jest.fn(async () => []) });

    await expect(drainQueue(ports, USER)).resolves.toEqual({ synced: 0, failed: 0 });
    expect(ports.createReading).not.toHaveBeenCalled();
  });
});

describe('runSync', () => {
  // Rule 1. A boolean flag would let the second caller skip the drain and
  // report success for work that had not happened yet.
  it('shares one in-flight pass between concurrent callers', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const ports = makePorts({
      listQueued: jest.fn(async () => {
        await gate;
        return [queuedRow()];
      }),
    });

    const first = runSync(ports, USER);
    const second = runSync(ports, USER);

    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);

    expect(ports.listQueued).toHaveBeenCalledTimes(1);
    expect(ports.createReading).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh pass once the previous one settles', async () => {
    const ports = makePorts();

    await runSync(ports, USER);
    await runSync(ports, USER);

    expect(ports.listQueued).toHaveBeenCalledTimes(2);
  });

  it('releases the mutex even when the pass throws', async () => {
    const ports = makePorts({
      listQueued: jest.fn(async () => {
        throw new Error('database gone');
      }),
    });

    await expect(runSync(ports, USER)).rejects.toThrow('database gone');
    // If the mutex leaked, this would return the settled rejected promise.
    await expect(runSync(makePorts(), USER)).resolves.toEqual({ synced: 1, failed: 0 });
  });
});
