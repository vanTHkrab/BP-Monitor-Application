import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `stateDiagram-v2
    [*] --> idle

    idle --> capturing: Tap shutter
    capturing --> preflight: Got camera URI
    capturing --> idle: Cancel

    preflight --> preflight_ok: YOLO verdict ok (auto-crop)
    preflight --> preflight_warn: no-monitor / missing-fields

    preflight_warn --> preflight_ok: User taps "ส่งต่อไป" (override)
    preflight_warn --> capturing: User taps "ถ่ายใหม่"

    preflight_ok --> analyzing: User confirms upload
    analyzing --> filled: AI returns sys/dia/pulse
    analyzing --> manual: AI timeout / fail (offer manual entry)
    analyzing --> idle: User cancels analysis

    filled --> editing: Pre-filled form shown
    manual --> editing: Empty form shown

    editing --> saving: User taps save
    saving --> [*]: createReading() succeeds (optimistic)
    saving --> editing: Validation error (e.g., out-of-range sys)
`;

export default function CameraStatePage() {
    return (
        <DiagramPage
            title="Camera Analysis State Machine"
            subtitle="The camera screen, from cold idle to a saved reading"
            description="Lives in client/hooks/use-camera-analysis.ts. Transitions are driven by user actions and the on-device YOLO verdict. Pre-flight is warn-not-block; AI failures fall back to manual entry — the user is never stranded."
            tags={["State", "Mobile", "UX"]}
        >
            <DiagramSection
                title="States and transitions"
                description="Each state is one of the discriminated members of the camera state union. The store keeps the latest verdict on state.preflight so the UI can render cropped preview or warning banner."
            >
                <Mermaid chart={chart} />
            </DiagramSection>

            <DiagramSection title="Why warn-not-block">
                <InsightList
                    items={[
                        {
                            label: "On-device false negatives are common",
                            detail:
                                "Glare, partial frames, low light. A hard block creates user rage in the field and a support ticket. The override path covers it.",
                        },
                        {
                            label: "Save path is independent of AI",
                            detail:
                                "manual state is a first-class peer of filled. If AI fails the user types values; the row still saves via the offline queue.",
                        },
                        {
                            label: "Optimistic save",
                            detail:
                                "saving → [*] is the success path. The reading is written to the local mirror immediately and reconciled by syncPendingReadings.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
