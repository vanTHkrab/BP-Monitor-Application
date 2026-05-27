import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `flowchart TD
    A["Shutter tap"] --> B["preflightCheckImage(uri)"]
    B --> C["letterbox + JPEG decode<br/>→ [1,3,512,512] float32 RGB"]
    C --> D["onnxruntime InferenceSession<br/>yolo12n.onnx (11.5 MB)"]
    D --> E["Decode [1, 4+C, anchors]<br/>per-class NMS<br/>(conf 0.25 / IoU 0.45)"]
    E --> F{"Classify verdict"}

    F -- "BP_Monitor or BP_Screen_Monitor<br/>+ sys + dia + pulse" --> OK["verdict = ok"]
    F -- "no BP_Monitor / BP_Screen_Monitor" --> NM["verdict = no-monitor"]
    F -- "missing sys / dia / pulse" --> MF["verdict = missing-fields"]

    OK --> CROP["Auto-crop around monitor bbox + padding"]
    CROP --> UPLOAD["Use cropped image for upload"]

    NM --> WARN["Show Thai warning banner"]
    MF --> WARN
    WARN --> CHOICE{"User choice"}
    CHOICE -- "ถ่ายใหม่" --> A
    CHOICE -- "ส่งต่อไป (override)" --> UPLOAD_RAW["Use original image for upload"]

    UPLOAD --> SAVE["Backend YOLO sees the same crop"]
    UPLOAD_RAW --> SAVE

    classDef ok fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef warn fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    class OK,CROP,UPLOAD,SAVE ok
    class WARN,CHOICE,UPLOAD_RAW warn
    class NM,MF bad
`;

export default function YoloPreflightPage() {
    return (
        <DiagramPage
            title="On-device YOLO Pre-flight"
            subtitle="Same model, same crop, two runtimes"
            description="A 11.5 MB ONNX detector runs on the phone before every upload. It classifies the frame as ok / no-monitor / missing-fields and (on ok) auto-crops around the monitor. The same model file runs in the FastAPI AI service — SHA256 equality is enforced by a prestart hook so the two sides cannot silently disagree."
            tags={["Flow", "ML", "Mobile"]}
        >
            <DiagramSection
                title="Decision tree"
                description="Green = happy path; yellow = override path; red = blocking verdicts (visually only — the override edge always exists)."
            >
                <Mermaid chart={chart} />
            </DiagramSection>

            <DiagramSection title="Shared-model contract">
                <InsightList
                    items={[
                        {
                            label: "Byte-identical model file",
                            detail:
                                "client/assets/models/yolo12n.onnx and server/app/ai-service/models/yolo12n.onnx are the same bytes. pnpm verify-yolo-model on every pnpm start asserts SHA256 equality.",
                        },
                        {
                            label: "Class IDs are a wire contract",
                            detail:
                                "0 BP_Monitor / 1 BP_Screen_Monitor / 2 dia / 3 pulse / 4 sys — mirrored in client/lib/yolo/types.ts and server/app/ai-service/src/ai_service/analyzer/yolo.py::CLASS_NAMES. Change one side, change the other.",
                        },
                        {
                            label: "Thresholds in lock-step",
                            detail:
                                "Confidence 0.25, IoU 0.45 — same on both sides. If you tune the detector, tune both call sites; otherwise the phone and the server make different calls.",
                        },
                        {
                            label: "Retraining process",
                            detail:
                                "Retrain in ai-service, drop the new .onnx in models/, then `cd client && pnpm sync-yolo-model`. Commit both copies in one PR or the verify hook fails.",
                        },
                    ]}
                />
            </DiagramSection>

            <DiagramSection title="Why warn-not-block">
                <InsightList
                    items={[
                        {
                            label: "Field reality",
                            detail:
                                "Glare, partial frames, low light — false negatives exist. Blocking would create a support ticket per missed shot.",
                        },
                        {
                            label: "Override is a single tap",
                            detail:
                                "ส่งต่อไป hands the original (uncropped) image to the backend. Backend YOLO + OCR may still succeed on a frame the on-device pass rejected.",
                        },
                        {
                            label: "Cost of override is cheap",
                            detail:
                                "S3 PUT + one Redis publish. The user pays slightly more data; the backend pays slightly more compute. Both are acceptable to avoid stranding a patient.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
