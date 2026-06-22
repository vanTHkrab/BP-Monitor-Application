import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `sequenceDiagram
    autonumber
    participant U as Patient
    participant App as Expo App
    participant YOLO as On-device YOLO
    participant GW as API Gateway
    participant S3 as S3 Bucket
    participant R as Redis
    participant AI as AI Service
    participant PG as Postgres

    U->>App: Open camera, capture photo
    App->>YOLO: preflightCheckImage(uri)
    YOLO-->>App: verdict { ok | no-monitor | missing-fields }, bbox

    alt verdict ok
        App->>App: Auto-crop around monitor + padding
    else verdict not ok
        App->>U: Show banner: "ถ่ายใหม่" / "ส่งต่อไป"
        U->>App: Tap "ส่งต่อไป" (override)
    end

    App->>GW: mutation uploadBPImage (multipart)
    GW->>S3: putObject (s3Key)
    GW-->>App: { jobId, s3Key }
    GW->>R: publish analyze_bp_image { jobId, userId, s3Key, presignedGetUrl }
    R-->>AI: deliver analyze_bp_image
    AI->>S3: GET presigned image
    AI->>AI: YOLO ROI → OCR → parse sys/dia/pulse
    AI->>R: publish analyze_bp_image.reply { jobId, sys, dia, pulse, score }
    R-->>GW: deliver reply
    GW->>PG: update Image.image_quality_score by s3Key (updateMany)

    loop poll every 1.5s
        App->>GW: query analysisJob(jobId)
        GW-->>App: status pending / done / failed
    end

    App->>U: Pre-fill sys/dia/pulse for confirmation
    U->>App: Confirm + save
    App->>App: createReading() optimistic update
    App->>GW: mutation submitBPReading
    GW->>PG: insert BloodPressureReading (+ Alert if needed)
    GW-->>App: BloodPressureReading { id, status }
    App->>App: Mark local row syncStatus=synced
`;

export default function BpCaptureSequencePage() {
    return (
        <DiagramPage
            title="BP Capture Flow"
            subtitle="From shutter tap to confirmed reading"
            description="Captures a blood-pressure monitor image, gates it through the on-device YOLO detector, uploads to S3, asks the AI service for sys/dia/pulse, then writes a reading once the user confirms. The same flow respects offline mode by deferring the final mutation."
            tags={["Sequence", "Mobile", "AI"]}
        >
            <DiagramSection
                title="End-to-end sequence"
                description="Numbers in the diagram match the ordering below. Steps 11-14 (poll loop) collapse to a single done in the common case."
            >
                <Mermaid chart={chart} />
            </DiagramSection>

            <DiagramSection title="Why on-device pre-flight">
                <InsightList
                    items={[
                        {
                            label: "Save backend roundtrips on obviously bad shots",
                            detail:
                                "If the model says no-monitor we never burn the AI service compute or the user's data plan. Verdict comes from a 10.7 MB ONNX model already on the phone.",
                        },
                        {
                            label: "Same model file on both sides",
                            detail:
                                "client/assets/models/yolo11n.onnx and server/app/ai-service/models/yolo11n.onnx are byte-identical (SHA256 enforced by prestart hook). The phone's verdict is the backend's verdict.",
                        },
                        {
                            label: "Warn, do not block",
                            detail:
                                'A "ส่งต่อไป" button always lets the user override. False negatives are common (lighting, glare); blocking would strand the patient.',
                        },
                    ]}
                />
            </DiagramSection>

            <DiagramSection title="Latency budget">
                <InsightList
                    items={[
                        {
                            label: "Capture → upload starts: under 1s",
                            detail:
                                "YOLO inference + crop + image-prepare on a mid-range Android phone. Above this the camera feels broken.",
                        },
                        {
                            label: "Upload → AI ack: 2-6s typical",
                            detail:
                                "S3 PUT + Redis publish + AI service handling. Poll cadence is 1.5s so the user sees a result within one tick of completion.",
                        },
                        {
                            label: "Save is independent of AI",
                            detail:
                                "If AI fails or the network drops, the user can still type values manually and the reading saves via the offline queue.",
                        },
                    ]}
                />
            </DiagramSection>

            <DiagramSection title="Failure modes worth naming">
                <InsightList
                    items={[
                        {
                            label: "Stale job after app restart",
                            detail:
                                "If the user backgrounds the app, the polling resumes by querying analysisJob(jobId) — we don't lose the result, but we do drop the visible spinner.",
                        },
                        {
                            label: "Image quality score back-write race",
                            detail:
                                "AiProcessor writes image_quality_score via updateMany by s3Key — a deleted Image row (cron-swept) does not fail the analysis.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
