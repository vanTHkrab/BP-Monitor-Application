import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
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
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="state/reading-lifecycle"
            chart={CHART}
            caption="A reading's state is which table it is in."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>There is no syncStatus column. The queue and the mirror are separate tables so no read can forget a WHERE clause.</li>
                <li>promoteToMirror inserts and deletes in one transaction. Split it and you get a duplicate or a vanished reading.</li>
                <li>The mirror keeps the local file:// URI, so a photo that never reached S3 still shows on the device that took it.</li>
            </ul>
        </DiagramShell>
    );
}
