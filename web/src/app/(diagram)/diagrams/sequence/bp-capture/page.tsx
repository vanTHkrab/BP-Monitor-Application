import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
sequenceDiagram
    autonumber
    participant U as Patient
    participant App as Expo app
    participant NV as bp-vision (Kotlin)
    participant GW as API Gateway
    participant S3 as S3 bucket
    participant Q as BullMQ (Redis)
    participant AI as AI Service
    participant PG as Postgres

    Note over App,NV: Live framing — analysis stream at ~4 fps
    loop every analysis frame
        App->>NV: detect(frame)
        NV-->>App: Detection[] (5 classes, source-image px)
        App->>App: evaluateFraming + advanceHysteresis<br/>searching / too-far / too-close / off-center / ready
    end

    alt framing holds "ready" and auto-capture is on
        App->>U: Arm after 300 ms, ring counts down 1500 ms
        App->>App: Shutter fires by itself
    else user taps the shutter
        App->>App: Manual capture — the gate never blocks it
    end

    App->>App: cropToViewport + prepareImageForAnalysis

    alt online
        App->>GW: mutation requestImageUpload { kind, mimeType, size }
        GW-->>App: { uploadUrl, key, headers, expiresAt }
        App->>S3: PUT bytes (uploadAsync, BINARY_CONTENT)
        App->>GW: mutation confirmImageUpload { key, kind }
        GW->>PG: insert Image row
        GW-->>App: { key, url, imageId }

        App->>GW: mutation analyzeBPImage { s3Key, mimeType, ocrEngine? }
        GW->>GW: assert s3Key belongs to caller + presign GET (600 s)
        GW->>Q: add job "analyze-bp-image" (3 attempts, exp backoff)
        GW-->>App: AnalysisJob { jobId, status: pending }

        Q-->>GW: worker reserves the job
        GW->>AI: PUBLISH analyze_bp_image { jobId, userId, s3Key, imageUrl, mimeType }
        AI->>S3: GET presigned image
        AI->>AI: YOLO → rectify → OCR → validate
        AI-->>GW: PUBLISH analyze_bp_image.reply { systolic, diastolic, pulse,<br/>confidence, status, engine, metrics, image_quality_score }
        GW->>PG: updateMany Image.image_quality_score by s3Key
        GW->>Q: store AnalysisResult on the job

        loop poll every 1.5 s, give up at 60 s
            App->>GW: query analysisJob(jobId)
            GW-->>App: pending / processing / done / failed
        end
    else offline or no network
        App->>NV: readBp(imageUri)
        NV-->>App: { sys, dia, pulse, confidence } or { unavailable }
    end

    alt confidence >= 0.5
        App->>U: Form pre-filled
    else lower, or no numbers at all
        App->>U: Ask to check the values, or leave the form empty
    end

    U->>App: Confirm + save
    App->>App: createReading() — enqueue into pending_readings
    App->>GW: mutation createReading { clientId, imageId?, ... }
    GW->>PG: insert BloodPressureReading (+ Alert if out of range)
    GW-->>App: BloodPressureReading { id, status }
    App->>App: promoteToMirror() — insert readings,<br/>delete pending_readings, one transaction
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="sequence/bp-capture"
            chart={CHART}
            caption="Three round trips pretending to be one call."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>Upload is presign → PUT → confirm. The bytes never pass through the gateway.</li>
                <li>analyzeBPImage only enqueues; the numbers arrive through analysisJob(jobId), polled every 1.5 s with a 60 s ceiling.</li>
                <li>The offline branch skips all of it and reads the display on the phone. Both branches end at the same save.</li>
            </ul>
        </DiagramShell>
    );
}
