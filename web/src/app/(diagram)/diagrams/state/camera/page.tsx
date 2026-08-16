import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
stateDiagram-v2
    [*] --> framing

    state framing {
        [*] --> searching
        searching --> too_far: monitor found, area < 8%
        searching --> too_close: area > 85%
        too_far --> off_center: distance ok
        too_close --> off_center: distance ok
        off_center --> ready: centre within 22%, 2 of 3 fields visible
        ready --> searching: shot drifts (hysteresis, then re-classify)
        ready --> armed: held ready for 300 ms, auto-capture on
        armed --> counting: ring appears
        counting --> ready: tap to cancel, or framing degrades
        counting --> [*]: countdown completes (1500 ms; 2500 ms with a screen reader)
    }

    framing --> captured: shutter fires — auto or manual tap
    captured --> prepared: cropToViewport + prepareImageForAnalysis

    state analysis {
        [*] --> online_or_not
        state online_or_not <<choice>>
        online_or_not --> uploading: network available
        online_or_not --> reading: offline / online path failed

        uploading --> queued: analyzeBPImage returned a jobId
        queued --> processing: worker picked the job up
        processing --> done: reply parsed
        processing --> failed: job failed or 60 s poll timeout
        uploading --> failed: presign, PUT, or confirm failed

        reading --> done: bp-vision returned sys/dia/pulse
        reading --> [*]: module unavailable — phase clears to idle
    }

    prepared --> analysis
    analysis --> prefilled: confidence >= 0.5
    analysis --> confirm_values: numbers, but confidence < 0.5
    analysis --> empty_form: failed, cancelled, or nothing read

    confirm_values --> prefilled: user accepts the values
    confirm_values --> empty_form: user rejects them

    prefilled --> editing
    empty_form --> editing
    editing --> saving: user taps save
    saving --> editing: validation error (e.g. sys out of range)
    saving --> [*]: createReading() — queued, then drained
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="state/camera"
            chart={CHART}
            caption="The framing gate, then the analysis phases."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>AnalysisPhase is literal: idle | reading | uploading | queued | processing | done | failed.</li>
                <li>0.5 is the confidence line for both engines — above it the form fills, below it the user is asked to check.</li>
                <li>Every failure path ends at a typeable form. Nothing about analysis can prevent a save.</li>
            </ul>
        </DiagramShell>
    );
}
