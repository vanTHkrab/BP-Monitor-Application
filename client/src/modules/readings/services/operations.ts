/**
 * Reading GraphQL operations.
 *
 * `clientId` is requested back on every read. It is what the mirror upsert
 * matches a locally-created row against, and without it a reading this device
 * queued would come back looking like somebody else's and appear twice.
 *
 * **`recordedBy` selects `firstname` + `lastname`, not `name`.** The gateway's
 * `ReadingRecordedByType` has no `name` field, and because this fragment is
 * shared by the query *and* the mutation, asking for one failed both with a
 * bare "Graphql validation error" — no readings ever pulled and no reading
 * ever synced. Anything added here has to exist on `ReadingType` in
 * `server/app/api-gateway/src/reading/reading.resolver.ts`; that file is the
 * source of truth and `src/schema.gql` is generated from it.
 */

const READING_FIELDS = `
  id
  userId
  clientId
  systolic
  diastolic
  pulse
  status
  measuredAt
  s3Key
  notes
  createdAt
  recordedBy { id firstname lastname }
`;

export const GQL_READINGS = `
  query Readings($limit: Int!, $offset: Int!, $patientId: ID) {
    readings(limit: $limit, offset: $offset, patientId: $patientId) { ${READING_FIELDS} }
  }
`;

export const GQL_CREATE_READING = `
  mutation CreateReading($input: CreateReadingInput!) {
    createReading(input: $input) { ${READING_FIELDS} }
  }
`;

export const GQL_DELETE_READING = `
  mutation DeleteReading($id: Int!) {
    deleteReading(id: $id)
  }
`;
