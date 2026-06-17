import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `sequenceDiagram
    autonumber
    actor U as User
    participant CAM as Camera Screen<br/>(use-camera-analysis)
    participant YOLO as On-device YOLO<br/>(lib/yolo)
    participant STORE as Zustand Store<br/>+ SQLite
    participant GW as API Gateway<br/>(NestJS)
    participant S3 as S3
    participant BMQ as BullMQ<br/>(ai-analysis)
    participant RDS as Redis pub/sub
    participant AI as ai-service<br/>(FastAPI)
    participant DB as Postgres

    U->>CAM: ถ่ายรูป / เลือกรูป
    CAM->>YOLO: runPreflight(imageUri)
    YOLO-->>CAM: verdict {ok|no-monitor|missing-fields}<br/>+ croppedUri

    alt verdict = ok
        CAM->>U: preview cropped
    else no-monitor / missing-fields
        CAM->>U: banner เตือน + ปุ่ม "ถ่ายใหม่" / "ส่งต่อไป"
    end
    U->>CAM: confirm

    Note over CAM,S3: Phase 2 — Upload
    CAM->>GW: mutation RequestImageUpload
    GW-->>CAM: {uploadUrl, key, headers}
    CAM->>S3: PUT bytes (presigned)
    S3-->>CAM: 200
    CAM->>GW: mutation ConfirmImageUpload
    GW->>DB: insert Image row
    GW-->>CAM: {key, url, imageId}

    Note over CAM,BMQ: Phase 3-4 — Enqueue + publish
    CAM->>GW: mutation AnalyzeBPImage(s3Key)
    GW->>GW: assertBPKeyOwnedBy<br/>+ presignGet (TTL 600s)
    GW->>BMQ: enqueue {jobId, imageUrl, ...}
    GW-->>CAM: {jobId, status:pending}
    BMQ->>RDS: publish analyze_bp_image

    Note over RDS,AI: Phase 5 — Pipeline
    RDS->>AI: message
    AI->>S3: GET imageUrl (presigned)
    S3-->>AI: image bytes
    AI->>AI: YOLO → rectify → YOLO → OCR → validate<br/>(timeout 30s)
    AI->>RDS: publish analyze_bp_image.reply<br/>{id, response}

    Note over RDS,GW: Phase 6 — Reply
    RDS->>BMQ: deliver reply
    BMQ->>DB: update Image.imageQualityScore
    BMQ->>S3: append metrics JSONL
    BMQ->>BMQ: job.returnvalue = AnalysisResult

    Note over CAM,GW: Phase 7 — Poll
    loop ทุก 1.5s, deadline 60s
        CAM->>GW: query PollAnalysisJob(jobId)
        GW->>BMQ: job.getState()
        BMQ-->>GW: state + returnvalue
        GW-->>CAM: {status, result?}
    end
    CAM->>U: prefill sys/dia/pulse<br/>(ถ้า confidence ≥ 0.70)

    Note over U,DB: Phase 8 — Save
    U->>CAM: confirm save
    CAM->>STORE: createReading(...)
    STORE->>STORE: optimistic insert (local-id)<br/>+ SQLite mirror pending
    STORE->>GW: mutation submitBPReading
    GW->>DB: BloodPressureReading.create<br/>connect Image
    DB-->>GW: reading row
    GW-->>STORE: {id, ...}
    STORE->>STORE: SQLite update in-place<br/>syncStatus=synced + remoteId
    STORE-->>U: ✓ saved

    Note over STORE,GW: Offline path
    alt offline / submit fail
        STORE->>STORE: คงไว้ pending
        STORE-->>GW: syncPendingReadings รอบหน้า<br/>(promise mutex)
    end

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
                                "If the model says no-monitor we never burn the AI service compute or the user's data plan. Verdict comes from a 11.5 MB ONNX model already on the phone.",
                        },
                        {
                            label: "Same model file on both sides",
                            detail:
                                "client/assets/models/yolo12n.onnx and server/app/ai-service/models/yolo12n.onnx are byte-identical (SHA256 enforced by prestart hook). The phone's verdict is the backend's verdict.",
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
