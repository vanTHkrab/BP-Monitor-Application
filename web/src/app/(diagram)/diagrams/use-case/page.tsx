import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `graph TB
    P((Patient))
    C((Caregiver))
    D((Developer / Ops))
    AI((AI Service))

    subgraph Mobile["Mobile App (Expo)"]
        UC1["Register / login"]
        UC2["Capture BP via camera"]
        UC3["Enter BP manually"]
        UC4["View history & charts"]
        UC5["Export readings (CSV/PDF)"]
        UC6["Manage profile & avatar"]
        UC7["Read community posts"]
        UC8["Write / comment / like posts"]
        UC9["Link caregiver"]
        UC10["Manage sessions / logout"]
    end

    subgraph Web["Web Dashboard (Next.js)"]
        UC11["Operations overview"]
        UC12["Inspect service status<br/>(Redis, AI, S3, DB)"]
        UC13["Browse clients & readings"]
        UC14["Review architecture diagrams"]
    end

    subgraph Async["Async surfaces"]
        UC15["Analyze BP image<br/>(YOLO ROI → OCR)"]
        UC16["Score image quality"]
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

    C --- UC4
    C --- UC7
    C --- UC8
    C --- UC9

    D --- UC11
    D --- UC12
    D --- UC13
    D --- UC14

    AI --- UC15
    AI --- UC16
    UC2 -.triggers.-> UC15
    UC15 -.produces.-> UC16

    classDef actor fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef uc fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
    classDef sys fill:#ede9fe,stroke:#7c3aed,color:#5b21b6
    class P,C,D actor
    class AI sys
    class UC1,UC2,UC3,UC4,UC5,UC6,UC7,UC8,UC9,UC10,UC11,UC12,UC13,UC14,UC15,UC16 uc
`;

export default function UseCasePage() {
    return (
        <DiagramPage
            title="Use Case Diagram"
            subtitle="Who uses the system, and for what"
            description="Three human actors and one machine actor. The mobile app is patient-centric, with caregivers as a read-mostly secondary persona. The web dashboard is currently ops-focused — no patient-facing UI on web."
            tags={["Use case", "Actors"]}
        >
            <DiagramSection
                title="Actors and surfaces"
                description="Solid links: actor uses use case. Dotted links: use case triggers another use case."
            >
                <Mermaid chart={chart} />
            </DiagramSection>

            <DiagramSection title="Persona notes">
                <InsightList
                    items={[
                        {
                            label: "Patient",
                            detail:
                                "Primary actor on mobile. Owns readings, posts, community comments. Logs BP via camera or manual entry; reviews history; can link a caregiver.",
                        },
                        {
                            label: "Caregiver",
                            detail:
                                "Read-mostly access to linked patients' readings + community participation. Wired through CaregiverPatient join with a typed relationship enum (parent/child/spouse/sibling/friend/caregiver_professional/other).",
                        },
                        {
                            label: "Developer / Ops",
                            detail:
                                "Web-only persona. Service-status cards, client browsers, and these architecture diagrams. No patient PHI write surface today.",
                        },
                        {
                            label: "AI Service",
                            detail:
                                "Non-human actor reached only via Redis pub/sub. Treated as a black box from the gateway's perspective — the contract is the channel payload.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
