/**
 * Blood-pressure reading types.
 *
 * Shapes mirror `server/app/api-gateway/src/schema.gql` (`ReadingType`,
 * `CreateReadingInput`) and `database/schema.ts` (`readings`,
 * `pendingReadings`). Three representations of the same measurement exist and
 * they are deliberately not collapsed into one:
 *
 *   - `Reading`        — what a screen renders. Dates are `Date`.
 *   - the drizzle row  — what SQLite stores. Dates are ISO strings, because
 *                        text sorts correctly and needs no conversion in a
 *                        `ORDER BY`.
 *   - the GraphQL payload — what the wire carries.
 *
 * `lib/mappers.ts` owns every conversion between them.
 */

/** Matches the gateway's stored `status` string and client-old's `BPStatus`. */
export type BPStatus = 'low' | 'normal' | 'elevated' | 'high' | 'critical';

/**
 * Where a reading currently lives.
 *
 * `queued` and `synced` are different **tables**, not a column — see
 * `database/schema.ts`. This field is derived when a row is read, so a screen
 * can render a pending badge without knowing which table it came from.
 */
export type ReadingSyncState = 'queued' | 'synced';

export type Reading = {
  /**
   * Stable across the queue→mirror promotion: it is the `clientId` for a
   * locally-created reading and `remote-<id>` for one first seen from the
   * server. A list key that changed when a row synced would remount the card
   * mid-scroll.
   */
  key: string;
  /** Server id. Absent until the reading has been confirmed. */
  remoteId?: number;
  /** Present for anything this device created. Absent for server-only rows. */
  clientId?: string;
  userId: string;

  systolic: number;
  diastolic: number;
  pulse: number;
  measuredAt: Date;
  status: BPStatus;
  notes?: string;

  /** Local `file://` path, while the photo still only exists on this device. */
  imageUri?: string;
  /** Server `Image.id`, set once the upload is confirmed. */
  imageId?: number;
  /** Server object key — the image reference a fetched row carries. */
  s3Key?: string;

  /** Set when a caregiver logged this on the patient's behalf. */
  recordedById?: string;
  recordedByName?: string;

  createdAt: Date;
  syncState: ReadingSyncState;
  /** Queued rows only: how many submit attempts have failed so far. */
  attempts?: number;
  /** Queued rows only: why the last attempt failed. Not shown to patients. */
  lastError?: string;
};

/**
 * A server-raised alert about a reading.
 *
 * In this module, not one of its own: `AlertType.bpReadingId` is non-null, so
 * every alert is about a reading by construction.
 */
export type Alert = {
  id: number;
  readingId: number;
  message: string;
  /** The gateway's own free-form level string. Rendered, not branched on. */
  level: string;
  isRead: boolean;
  createdAt: Date;
  /**
   * The snapshot the gateway embeds so the list does not need a follow-up
   * query per row. Absent only if the reading was deleted after the alert.
   */
  /**
   * True when this alert reached the signed-in user because they *care for*
   * the person it is about, rather than being about them. Derived from the
   * reading's owner — see `alertFromGql`.
   */
  isAboutSomeoneElse: boolean;
  reading?: {
    remoteId: number;
    systolic: number;
    diastolic: number;
    pulse: number;
    status: BPStatus;
    measuredAt: Date;
  };
};

export type CreateReadingInput = {
  systolic: number;
  diastolic: number;
  pulse: number;
  /**
   * When the measurement was taken — **not** when it was saved. The camera
   * flow stamps this at capture, so an offline capture saved an hour later
   * keeps the real time.
   */
  measuredAt: Date;
  notes?: string;
  /** Local file URI of the captured photo, if there is one. */
  imageUri?: string;
  /**
   * Server `Image.id`, when the photo is already on S3.
   *
   * The camera's online path uploads the photo to run AI analysis on it, so by
   * the time the reading is saved the bytes are already in the bucket. Passing
   * the id here is what stops the drain uploading the same file a second time
   * and minting a second `Image` row — see `resolveImageId` in `lib/sync.ts`.
   */
  imageId?: number;
  /**
   * Caregiver-on-behalf writes. Requires an accepted caregiver link; the
   * gateway enforces it (`assertCanActOnBehalfOf`).
   */
  patientId?: string;
};
