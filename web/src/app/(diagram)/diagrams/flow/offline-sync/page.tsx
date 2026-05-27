import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `flowchart TD
    A["User saves reading"] --> B["createReading()<br/>optimistic update<br/>(Zustand store)"]
    B --> C{"Online?"}
    C -- "Yes" --> D["submitBPReading (GraphQL)"]
    D -- "Success" --> E["Mark local row syncStatus=synced<br/>set remoteId"]
    D -- "Network / 5xx" --> F["Insert into pending_readings<br/>syncStatus=pending"]
    C -- "No" --> F

    G["Network reconnects /<br/>App becomes foreground"] --> H["syncPendingReadings()"]
    H --> I{"Mutex held?"}
    I -- "Yes" --> J["Return in-flight promise"]
    I -- "No" --> K["Acquire mutex"]
    K --> L["For each pending row"]
    L --> M{"Has image?"}
    M -- "Yes" --> N["S3 PUT signed URL<br/>(FileSystem.uploadAsync on native)"]
    M -- "No" --> O["submitBPReading"]
    N --> O
    O -- "Success" --> P["Update row syncStatus=synced<br/>set remoteId"]
    O -- "Failure" --> Q["Stay pending"]
    P --> R["Release mutex"]
    Q --> R

    S["fetchReadings()"] --> T["Server returns confirmed list"]
    T --> U["Reconcile:<br/>refresh synced rows<br/>preserve pending / syncing"]
`;

export default function OfflineSyncPage() {
    return (
        <DiagramPage
            title="Offline Sync Flow"
            subtitle="How writes survive the network being down"
            description="The store is the source of truth from the user's perspective. Postgres is the source of truth from the server's perspective. The offline queue + sync mutex + reconciliation step reconcile the two without losing or duplicating rows."
            tags={["Flow", "Offline-first", "Mobile"]}
        >
            <DiagramSection
                title="Save → sync → reconcile"
                description="Branches show the path under network loss; the happy path is the leftmost spine."
            >
                <Mermaid chart={chart} />
            </DiagramSection>

            <DiagramSection title="Invariants">
                <InsightList
                    items={[
                        {
                            label: "One mutex per sync function",
                            detail:
                                "syncPendingReadings and syncPendingPosts each hold a promise-based mutex. Concurrent callers return the in-flight promise — never replaced with a boolean.",
                        },
                        {
                            label: "Optimistic update never blocks UI",
                            detail:
                                "createReading writes to the store before any network call. The UI shows the new reading in <16ms even on a flaky link.",
                        },
                        {
                            label: "pending_readings is queue AND mirror",
                            detail:
                                "syncStatus discriminates: pending (queued), pending-image (queued, image upload not done), synced (server-confirmed). Reinstall + offline launch still shows history because synced rows live in the same table.",
                        },
                        {
                            label: "Reconciliation refreshes, not replaces",
                            detail:
                                "fetchReadings refreshes synced rows from the server but preserves pending / pending-image. A reconciliation pass while a sync is in flight cannot eat queued rows.",
                        },
                    ]}
                />
            </DiagramSection>

            <DiagramSection title="What can still go wrong">
                <InsightList
                    items={[
                        {
                            label: "App killed mid-sync",
                            detail:
                                "Rows that were `syncing` on kill come back as `pending` next launch (mutex isn't durable). createClientId is the dedupe — server's @@unique on client_id absorbs the retry.",
                        },
                        {
                            label: "Clock skew on measuredAt",
                            detail:
                                "measuredAt comes from the device; we don't correct it. A patient with the wrong phone clock will have history that disagrees with the caregiver's view.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
