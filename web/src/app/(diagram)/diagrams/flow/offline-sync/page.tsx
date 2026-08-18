import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
flowchart TD
    A["User saves a reading"] --> B["createReading()<br/>mint clientId — never regenerated"]
    B --> C["enqueueReading()<br/>INSERT INTO pending_readings"]
    C --> Z["Screen returns immediately"]

    G["Trigger: session resolves ·<br/>foreground · offline→online ·<br/>pull-to-refresh"] --> H["useReadingsSync.refresh()<br/>push first, then pull"]
    H --> I{"runSync: mutex held?"}
    I -- "yes" --> J["Return the in-flight promise —<br/>a promise, not a boolean"]
    I -- "no" --> K["drainQueue(userId)"]
    K --> L["listQueuedReadings()"]

    L --> M{"row.imageId already set?"}
    M -- "yes" --> E["createReading mutation<br/>clientId + imageId + patientId?"]
    M -- "no" --> N{"local imageUri?"}
    N -- "none / already remote" --> E
    N -- "yes" --> O["presign → PUT → confirm"]
    O -- "ok" --> P2["markQueuedImageUploaded()<br/>persisted BEFORE the create"]
    P2 --> E
    O -- "file is gone" --> E
    O -- "failed, attempts < 3" --> R["recordQueueFailure()<br/>row keeps its place and its error"]
    O -- "failed, attempts = 3" --> E

    E -- "success" --> P["promoteToMirror()<br/>INSERT readings + DELETE pending_readings<br/>ONE transaction"]
    E -- "network / 5xx / 4xx" --> R
    E -- "BAD_USER_INPUT and row has imageId" --> F2["forgetQueuedImage()<br/>then record the failure"]
    F2 --> R

    P --> RL["releaseImage() — best effort,<br/>skipped when the local copy is the only copy"]
    RL --> NEXT["Next row — one failure never stops the queue"]
    R --> NEXT

    T["fetchReadings() — the pull half"] --> U["Server returns the confirmed list"]
    U --> V["upsertMirrorRows() + pruneMissingMirrorRows()<br/>touches the mirror only —<br/>the queue is never read or written here"]
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="flow/offline-sync"
            chart={CHART}
            caption="Save, drain, reconcile — three separate concerns."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>The mutex hands out the in-flight promise, not a boolean. A second caller waits for the same work.</li>
                <li>An upload is recorded before the create runs, so a crash between the two is resumable without minting a second Image row.</li>
                <li>One row&apos;s failure never stops the queue; failures are recorded on the row and the drain moves on.</li>
            </ul>
        </DiagramShell>
    );
}
