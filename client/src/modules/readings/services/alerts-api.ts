/**
 * The gateway side of alerts. I/O only.
 */
import { graphqlRequest } from '@/services/api';

import { parseStatus } from '../lib/status';
import type { Alert } from '../types';
import { GQL_ALERTS, GQL_MARK_ALERT_READ, GQL_MARK_ALL_ALERTS_READ } from './alert-operations';

const ALERTS_PAGE_SIZE = 100;

type AlertPayload = {
  id: number;
  userId: string;
  bpReadingId: number;
  alertMessage: string;
  alertLevel: string;
  readAt: string | null;
  createdAt: string;
  reading: {
    id: number;
    systolic: number;
    diastolic: number;
    pulse: number;
    status: string;
    measuredAt: string;
    s3Key: string | null;
  } | null;
};

function alertFromGql(payload: AlertPayload): Alert {
  return {
    id: payload.id,
    readingId: payload.bpReadingId,
    message: payload.alertMessage,
    level: payload.alertLevel,
    isRead: payload.readAt !== null,
    createdAt: new Date(payload.createdAt),
    reading: payload.reading
      ? {
          remoteId: payload.reading.id,
          systolic: payload.reading.systolic,
          diastolic: payload.reading.diastolic,
          pulse: payload.reading.pulse,
          status: parseStatus(payload.reading.status),
          measuredAt: new Date(payload.reading.measuredAt),
        }
      : undefined,
  };
}

export async function fetchAlerts(patientId?: string): Promise<Alert[]> {
  const data = await graphqlRequest<{ alerts: AlertPayload[] }>(GQL_ALERTS, {
    limit: ALERTS_PAGE_SIZE,
    offset: 0,
    unreadOnly: false,
    // Omitted rather than sent as the caller's own id: the gateway takes a
    // present `patientId` as "acting on behalf of" and runs the caregiver
    // guard for it, which is work with no answer to give when it is yourself.
    patientId: patientId ?? null,
  });
  return data.alerts.map(alertFromGql);
}

export async function markAlertRead(id: number): Promise<boolean> {
  const data = await graphqlRequest<{ markAlertRead: boolean }>(GQL_MARK_ALERT_READ, { id });
  return data.markAlertRead;
}

export async function markAllAlertsRead(): Promise<boolean> {
  const data = await graphqlRequest<{ markAllAlertsRead: boolean }>(GQL_MARK_ALL_ALERTS_READ);
  return data.markAllAlertsRead;
}
