import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
flowchart TD
    A["Analysis frame (~4 fps)"] --> B["BPVision.detect(uri, w, h, 512)"]
    B --> C["Kotlin: letterbox → [1,3,512,512] float32<br/>ONNX Runtime session (CPU / XNNPACK / NNAPI)"]
    C --> D["Decode [1, 4+C, anchors]<br/>per-class NMS — conf 0.25 / IoU 0.45"]
    D --> E["Detection[] in source-image pixels"]

    E --> F["evaluateFraming(frame)"]
    F --> G{"Monitor box present?<br/>(class 0 or 1, highest confidence)"}
    G -- "no" --> S["searching"]
    G -- "yes" --> H{"area ratio"}
    H -- "< 0.08" --> TF["too-far"]
    H -- "> 0.85" --> TC["too-close"]
    H -- "in range" --> I{"centre offset <= 0.22<br/>and >= 2 of sys/dia/pulse"}
    I -- "no" --> OC["off-center"]
    I -- "yes" --> T{"field-line tilt <= 10 deg?<br/>(estimateFieldTiltDeg — null = no opinion)"}
    T -- "no" --> TI["tilted"]
    T -- "yes" --> R["ready"]

    S --> HY["advanceHysteresis — a verdict must hold<br/>FRAMING_DWELL_MS (500 ms) before the UI moves"]
    TF --> HY
    TC --> HY
    OC --> HY
    TI --> HY
    R --> HY

    HY --> J{"ready held 300 ms<br/>and auto-capture enabled?"}
    J -- "no" --> COACH["Show the coaching line only.<br/>Manual shutter always available"]
    J -- "yes" --> CD["Countdown ring<br/>1500 ms (2500 ms with a screen reader)"]
    CD -- "tap to cancel / framing degrades" --> COACH
    CD --> SHOT["Shutter fires"]
    COACH --> SHOT

    SHOT --> CROP["prepareCaptureForAnalysis — crop to the viewport,<br/>then resize, in one chain and one save"]
    CROP --> OUT{"Online?"}
    OUT -- "yes" --> UP["presign → PUT → confirm → analyzeBPImage"]
    OUT -- "no" --> LOCAL["BPVision.readBp(uri)<br/>YOLO ROI → rectify → CRNN"]

    classDef ok fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef warn fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    class R,CD,SHOT,CROP,UP ok
    class COACH,OC,TI,LOCAL warn
    class S,TF,TC bad
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="flow/yolo-preflight"
            chart={CHART}
            caption="Frame in, framing verdict out — at roughly 4 fps."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>Detection is native Kotlin (client/modules/bp-vision/), not onnxruntime-react-native, and it degrades to “unavailable” off Android.</li>
                <li>minFields is 2 rather than 3 on purpose: requiring all three digit groups makes ready hostage to the hardest one to detect.</li>
                <li>Nothing here can block a manual shutter tap. The gate only drives auto-capture.</li>
            </ul>
        </DiagramShell>
    );
}
