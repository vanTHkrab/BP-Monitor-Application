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
        off_center --> tilted: centre within 22%, 2 of 3 fields visible
        tilted --> ready: field line within 10 deg of upright
        ready --> searching: shot drifts (hysteresis, then re-classify)
        ready --> armed: held ready for 300 ms, auto-capture on
        armed --> counting: ring appears
        counting --> ready: tap to cancel, or framing degrades
        counting --> [*]: countdown completes (1500 ms; 2500 ms with a screen reader)
    }

    framing --> captured: shutter fires — auto or manual tap
    captured --> prepared: prepareCaptureForAnalysis (crop + resize, one save)

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
    analysis --> prefilled: numbers read — filled whatever the confidence
    analysis --> unreadable_dialog: engine ran on this photo and read nothing
    analysis --> empty_form: failed (user taps ยืนยันภาพ), or no engine on this platform
    analysis --> [*]: superseded by a retake — no fill, no sheet, no dialog

    prefilled --> prefilled: confidence < 0.5 — review banner, single ack
    unreadable_dialog --> framing: "ถ่ายใหม่" — back to the live preview
    unreadable_dialog --> empty_form: "กรอกเอง" — manual entry, fields blank

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
                <li>0.5 is the confidence line for both engines — it decides whether the user is asked to double-check, not whether the form fills. Both sides auto-fill; below it a review banner asks for a single acknowledgement.</li>
                <li>An engine that ran and read nothing interrupts with a dialog, not a banner — the fix is physical (square the monitor, don&apos;t tilt it, don&apos;t hold it upside down). Its two actions are retake, or type the numbers by hand.</li>
                <li>Every failure path ends at a typeable form. Nothing about analysis can prevent a save.</li>
                <li>Retaking invalidates an analysis still in flight on both sides, so a late result from a discarded photo stays silent.</li>
            </ul>
        </DiagramShell>
    );
}
