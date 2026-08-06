/**
 * The gateway side of readings. I/O only — it calls, maps, and returns; it
 * does not touch SQLite and it does not format errors.
 */
import { graphqlRequest } from '@/services/api';

import { readingFromGql, type ReadingPayload } from '../lib/mappers';
import type { BPStatus, Reading } from '../types';
import { GQL_CREATE_READING, GQL_DELETE_READING, GQL_READINGS } from './operations';

/**
 * The gateway's own default is 200. Stated here because the prune step in
 * `lib/sync.ts` deletes mirrored rows this fetch did not return, and it can
 * only do that safely while one page is the whole history. When pagination
 * arrives, the prune has to become range-scoped in the same change.
 */
export const READINGS_PAGE_SIZE = 200;

export async function fetchReadings(patientId?: string): Promise<Reading[]> {
  const data = await graphqlRequest<{ readings: ReadingPayload[] }>(GQL_READINGS, {
    limit: READINGS_PAGE_SIZE,
    offset: 0,
    patientId: patientId ?? null,
  });
  return data.readings.map(readingFromGql);
}

/** What the gateway's `CreateReadingInput` accepts, in wire form. */
export type CreateReadingPayload = {
  systolic: number;
  diastolic: number;
  pulse: number;
  status: BPStatus;
  /** ISO 8601 — the `DateTime` scalar parses it with `new Date()`. */
  measuredAt: string;
  /** Minted once by this device; the server's duplicate guard keys on it. */
  clientId: string;
  imageId?: number | null;
  notes?: string | null;
  patientId?: string | null;
};

export async function createReading(input: CreateReadingPayload): Promise<Reading> {
  const data = await graphqlRequest<{ createReading: ReadingPayload }>(GQL_CREATE_READING, {
    input,
  });
  return readingFromGql(data.createReading);
}

export async function deleteReading(id: number): Promise<boolean> {
  const data = await graphqlRequest<{ deleteReading: boolean }>(GQL_DELETE_READING, {
    id,
  });
  return data.deleteReading;
}
