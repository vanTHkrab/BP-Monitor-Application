---
title: Reading Lifecycle
description: >-
    Offline-first state machine for a single BP reading. Two SQLite tables,
    not one: pending_readings is the outbox and readings is the mirror of what
    the server confirmed. A sync promotes a row from one to the other inside a
    single transaction, which is the invariant the whole design rests on.
status: current
updated: 2026-08-16
owner: client
---

## Lifecycle

A reading's state is **which table it is in**, not a column value. There is no
`syncStatus`: a queued row lives in `pending_readings`, a confirmed row lives
in `readings`, and `promoteToMirror` moves it across in one transaction
(`client/src/modules/readings/repository/mirror.ts`).

```mermaid
stateDiagram-v2
    [*] --> Queued: createReading() — clientId minted here

    state "pending_readings (outbox)" as Queued {
        [*] --> awaiting_upload: saved with a local photo
        [*] --> ready: saved with no photo, or an already-remote URI
        awaiting_upload --> ready: confirmUploadImage ok →<br/>markQueuedImageUploaded(imageId)
        awaiting_upload --> awaiting_upload: upload failed, attempts < 3
        awaiting_upload --> ready: local file missing, or budget spent —<br/>the numbers go up without the photo
        ready --> ready: network / 5xx / 4xx →<br/>recordQueueFailure(attempts + 1, message)
    }

    Queued --> Mirrored: promoteToMirror() in ONE transaction<br/>server confirmed, row deleted from the queue

    state "readings (mirror)" as Mirrored {
        [*] --> confirmed
        confirmed --> confirmed: fetchReadings() upserts the server's version
    }

    Mirrored --> [*]: pruneMissingMirrorRows()<br/>server no longer has it
    Mirrored --> [*]: clearMirror() on subject change or logout
```

## Why two tables and not one

The old client kept a single `pending_readings` table doing both jobs, told
apart by a `syncStatus` column. That design is gone, and the reason it went is
worth keeping: **every read had to remember to filter on the column, and
forgetting to was a bug the patient saw** — as duplicated or missing history.
`client/src/database/schema.ts` records this at the top of the file.

- **The question becomes structural.** "Which rows still need sending?" is
  answered by which table you are looking at, not by a predicate a future
  caller can omit.
- **Each table is indexed for its own job.** The queue is short-lived and
  write-heavy; the mirror is long-lived and read-heavy.
- **Reinstall safety is unchanged.** The mirror keeps confirmed rows on device,
  so an offline launch after a reinstall still shows history. Splitting the
  tables did not cost that — the mirror is what provides it.

**The cost, and the invariant:** confirming a sync now writes to two tables.
`promoteToMirror` does the insert and the delete in a single transaction. A
non-transactional version can insert without deleting (the reading duplicates)
or delete without inserting (the reading vanishes). That transaction is the one
thing this design depends on.

## Adjacent rules

- **The sync mutex** — concurrent callers get the in-flight promise rather than
  starting a second pass. Do not replace it with a boolean flag; that is
  race-prone.
- **Sync is triggered in exactly one place** —
  `modules/readings/hooks/use-readings-sync.tsx` owns the app's only `AppState`
  and `NetInfo` listeners and the only automatic pull. Screens call
  `useReadingsSync()`. Wiring `useFetchReadings` or `useSyncReadings` into a
  screen reintroduces duplicated listeners and a pull that only runs on
  pull-to-refresh.
- **`createClientId(prefix, userId)`**, wrapped as `createReadingClientId` —
  timestamp plus randomness, and the primary key of the queue, so a retried
  submit cannot enqueue the same reading twice. Never hand-roll it from
  `Math.random()`: a collision is a silent overwrite.
- **`attempts` and `lastError` live on the queued row** — the debug screen reads
  them, patients never see them, and the upload budget
  (`IMAGE_ATTEMPT_LIMIT = 3`) is counted against the same column.
- **The mirror keeps the local `file://` URI** — `toMirrorRow` carries
  `imageUri` over from the queued row rather than taking it from the server
  response, so a photo that never reached S3 still shows on the device that
  took it.
