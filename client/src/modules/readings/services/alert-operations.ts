/**
 * Alert GraphQL operations.
 *
 * Alerts live in `modules/readings` rather than a module of their own because
 * every alert *is* about a reading — `AlertType.bpReadingId` is non-null and
 * the embedded `reading` is a subset of `ReadingType`. A separate module
 * would be one barrel and one folder around a single query pair.
 *
 * `reading` is requested inline: the gateway embeds a snapshot of the reading
 * that triggered the alert precisely so the notification list does not need a
 * follow-up query per row. Dropping it would turn one request into N.
 */

const ALERT_FIELDS = `
  id
  userId
  bpReadingId
  alertMessage
  alertLevel
  readAt
  createdAt
  reading {
    id
    userId
    systolic
    diastolic
    pulse
    status
    measuredAt
    s3Key
  }
`;

/**
 * `patientId` mirrors `readings(patientId:)`, and exists for the same reason:
 * without it a caregiver viewing a patient saw that patient's readings beside
 * their own unread count. Null/omitted means "my own".
 */
export const GQL_ALERTS = `
  query Alerts($limit: Int!, $offset: Int!, $unreadOnly: Boolean!, $patientId: ID) {
    alerts(limit: $limit, offset: $offset, unreadOnly: $unreadOnly, patientId: $patientId) { ${ALERT_FIELDS} }
  }
`;

export const GQL_MARK_ALERT_READ = `
  mutation MarkAlertRead($id: Int!) {
    markAlertRead(id: $id)
  }
`;

export const GQL_MARK_ALL_ALERTS_READ = `
  mutation MarkAllAlertsRead {
    markAllAlertsRead
  }
`;
