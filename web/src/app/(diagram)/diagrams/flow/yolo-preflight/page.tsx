import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
flowchart TD
    A["Analysis frame (~4 fps)"] --> B["BPVision.detect(uri, w, h, 512)"]
    B --> C["Kotlin: letterbox → [1,3,512,512] float32<br/>ONNX Runtime session (CPU / XNNPACK / NNAPI)"]
    C --> D["Decode by the loaded graph's output shape<br/>[1,4+C,anchors] → per-class NMS here (yolo11n family)<br/>[1,300,6] → already suppressed (yolo26n family, loaded today)<br/>conf 0.25 / IoU 0.45 on the anchors path only"]
    D --> E["Detection[] in source-image pixels"]

    E --> F["evaluateFraming(frame, viewportAspect)"]
    F --> V["Visible rect = computeCoverCropBox(frame, viewportAspect)<br/>the ~80% of a 16:9 frame FILL_CENTER leaves on screen<br/>every ratio below is against this, not the whole frame"]
    V --> G{"Monitor box present?<br/>(screen class 1 preferred, body class 0 as fallback)"}
    G -- "no" --> S["searching"]
    G -- "yes" --> H{"area ratio, per class"}
    H -- "class 0 < 0.10 / class 1 < 0.04" --> TF["too-far"]
    H -- "class 0 > 0.90 / class 1 > 0.55" --> TC["too-close"]
    H -- "in range" --> I{"centre offset <= 0.22 of the visible extent<br/>and >= 2 of sys/dia/pulse"}
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
