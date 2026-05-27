import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `stateDiagram-v2
    [*] --> draft: User taps "save"

    draft --> pending: Save with no image
    draft --> pending_image: Save with attached photo

    pending --> syncing: syncPendingReadings() picks row
    pending_image --> syncing_image: image upload begins

    syncing --> synced: submitBPReading succeeds
    syncing --> pending: Network / 5xx (stay queued)
    syncing --> failed: 4xx with non-recoverable code

    syncing_image --> syncing: S3 PUT done, image attached
    syncing_image --> pending_image: Network drop (retry next sync)

    synced --> synced: Subsequent reads hit local mirror
    synced --> [*]: Cleaned by fetchReadings reconciliation

    failed --> pending: User retries from history screen
`;

export default function ReadingLifecyclePage() {
    return (
        <DiagramPage
            title="Reading Lifecycle"
            subtitle="Offline-first state machine for a single BP reading"
            description="pending_readings doubles as the offline queue and the synced mirror — rows carry a syncStatus column that distinguishes queue (pending / pending-image) from cache (synced) and a remoteId once the server confirms. Reinstall + offline launch keeps history visible because the rows never leave the table."
            tags={["State", "Mobile", "Offline-first"]}
        >
            <DiagramSection
                title="Lifecycle"
                description="States mirror the syncStatus column in pending_readings (client/data/local-db.ts)."
            >
                <Mermaid chart={chart} />
            </DiagramSection>

            <DiagramSection title="Why one table for queue and mirror">
                <InsightList
                    items={[
                        {
                            label: "Reinstall safety",
                            detail:
                                "If we deleted synced rows the moment the server confirmed, an offline launch after reinstall would show an empty history even though it just succeeded a minute ago. Keeping the row preserves the user's mental model.",
                        },
                        {
                            label: "No deletion race",
                            detail:
                                "A sync now marks rows synced in place (with remoteId set) rather than DELETE-then-INSERT. Partial sync, duplicate sync, and lost mutex releases can't leave data in a torn state.",
                        },
                        {
                            label: "Reconciliation is the source of truth",
                            detail:
                                "fetchReadings is the single point that reconciles local mirror with the server. Pending/syncing rows stay; synced rows refresh from the server response.",
                        },
                    ]}
                />
            </DiagramSection>

            <DiagramSection title="Adjacent rules">
                <InsightList
                    items={[
                        {
                            label: "syncReadingsPromise mutex",
                            detail:
                                "Concurrent callers of syncPendingReadings return the in-flight promise instead of starting a second pass. Don't replace this with a boolean flag — race-prone.",
                        },
                        {
                            label: "Local IDs are typed",
                            detail:
                                "Local rows have id prefixed with `local-`. isLocalReadingId is the only canonical check; string-matching `local-` elsewhere is a code smell.",
                        },
                        {
                            label: "createClientId(prefix, userId)",
                            detail:
                                "Timestamp + 120 bits of randomness. Never use Math.random().slice(...) ad-hoc — collisions create silent overwrites when two devices sync the same user.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
