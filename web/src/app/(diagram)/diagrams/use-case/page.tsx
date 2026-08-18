import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
graph TB
    P((Patient))
    C((Caregiver))
    D((Developer / Ops))
    AI((AI Service))

    subgraph Mobile["Mobile app (Expo) — the product"]
        UC1["Register / sign in<br/>phone, Google, or passkey"]
        UC2["Capture BP with the camera"]
        UC3["Enter BP manually"]
        UC4["View history, trends, alerts"]
        UC5["Export readings (CSV / PDF)"]
        UC6["Manage profile & avatar"]
        UC7["Read community posts"]
        UC8["Write / comment / like"]
        UC9["Invite or accept a caregiver link"]
        UC10["Manage devices & sessions"]
        UC17["Harden the account<br/>password, passkeys, app lock"]
        UC18["Set measurement reminders"]
        UC19["Read health tips"]
        UC20["Record a reading for a patient"]
        UC21["Edit a patient's health info"]
        UC22["Review who changed what<br/>(profile change log)"]
    end

    subgraph Web["Web app (Next.js) — team-only, local"]
        UC11["Read the docs site"]
        UC12["Inspect service status<br/>gateway · DB · Redis · S3 · AI"]
        UC13["Browse clients & readings"]
        UC14["Review these diagrams"]
        UC23["Read the task board"]
    end

    subgraph Async["Async surfaces"]
        UC15["Analyze BP image<br/>YOLO → rectify → OCR → validate"]
        UC16["Score image quality"]
        UC24["Send push notifications"]
    end

    P --- UC1
    P --- UC2
    P --- UC3
    P --- UC4
    P --- UC5
    P --- UC6
    P --- UC7
    P --- UC8
    P --- UC9
    P --- UC10
    P --- UC17
    P --- UC18
    P --- UC19
    P --- UC22

    C --- UC1
    C --- UC4
    C --- UC7
    C --- UC8
    C --- UC9
    C --- UC20
    C --- UC21

    D --- UC11
    D --- UC12
    D --- UC13
    D --- UC14
    D --- UC23

    AI --- UC15
    AI --- UC16

    UC2 -.triggers.-> UC15
    UC15 -.produces.-> UC16
    UC20 -.attributed via recordedById.-> UC4
    UC21 -.always writes.-> UC22
    UC4 -.out-of-range reading.-> UC24

    classDef actor fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef uc fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
    classDef sys fill:#ede9fe,stroke:#7c3aed,color:#5b21b6
    class P,C,D actor
    class AI sys
    class UC1,UC2,UC3,UC4,UC5,UC6,UC7,UC8,UC9,UC10,UC11,UC12,UC13,UC14,UC15,UC16,UC17,UC18,UC19,UC20,UC21,UC22,UC23,UC24 uc
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="use-case"
            chart={CHART}
            caption="Solid links: actor uses use case. Dotted: one use case triggers another."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>Caregiver edges are drawn for the full permission. A view link keeps only the read-only ones.</li>
                <li>A caregiver can never edit a patient&apos;s email or phone — both are sign-in identifiers, so the caregiver edit path has its own input type.</li>
                <li>The web column is a laptop, not a deployment. There is no authentication anywhere in that app.</li>
            </ul>
        </DiagramShell>
    );
}
