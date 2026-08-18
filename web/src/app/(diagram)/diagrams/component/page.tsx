import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
flowchart LR
    subgraph CMP_CLIENT["⬛ Component: Mobile app"]
        CL_UI["UI + feature modules"]
        CL_TX["Transport<br/>graphqlRequest"]
        CL_DB["Local store<br/>SQLite outbox + mirror"]
        CL_NAT["bp-vision<br/>native detector + OCR"]
    end

    subgraph CMP_GW["⬛ Component: API Gateway"]
        GW_GQL["GraphQL API"]
        GW_AUTH["Auth + guard"]
        GW_STO["Storage service"]
        GW_AI["AI bridge<br/>producer + worker"]
        GW_DATA["Prisma"]
    end

    subgraph CMP_AI["⬛ Component: AI Service"]
        AI_SUB["Redis subscriber"]
        AI_PIPE["Analysis pipeline"]
    end

    subgraph CMP_WEB["⬛ Component: Web app (local only)"]
        WB_ADMIN["Status pages"]
        WB_DOCS["Docs + diagrams"]
    end

    IF_GQL{{"«interface» GraphQL schema<br/>queries · mutations · extensions.code"}}
    IF_AUTH{{"«interface» Bearer token<br/>Authorization header + 401 semantics"}}
    IF_S3{{"«interface» S3 key layout<br/>users/{userId}/bp/readings/{YYYY-MM}/{uuid}"}}
    IF_JOB{{"«interface» BullMQ job<br/>queue ai-analysis · AnalysisJobPayload"}}
    IF_MSG{{"«interface» Redis channels<br/>analyze_bp_image (+ .reply)"}}
    IF_MODEL{{"«interface» Shared model<br/>yolo26n-adamw-color.onnx + class IDs 0–4"}}
    IF_SQL{{"«interface» Postgres schema<br/>Prisma migrations"}}

    CL_UI --> CL_TX
    CL_UI --> CL_DB
    CL_UI --> CL_NAT
    CL_TX --> IF_GQL
    CL_TX --> IF_AUTH
    CL_TX --> IF_S3
    CL_NAT --> IF_MODEL

    IF_GQL --> GW_GQL
    IF_AUTH --> GW_AUTH
    GW_GQL --> GW_AUTH
    GW_GQL --> GW_STO
    GW_GQL --> GW_AI
    GW_GQL --> GW_DATA
    GW_STO --> IF_S3
    GW_AI --> IF_JOB
    IF_JOB --> GW_AI
    GW_AI --> IF_MSG
    GW_DATA --> IF_SQL

    IF_MSG --> AI_SUB
    AI_SUB --> AI_PIPE
    AI_PIPE --> IF_MODEL
    AI_PIPE --> IF_S3

    WB_ADMIN --> IF_SQL
    WB_ADMIN --> IF_S3
    WB_ADMIN -. "hello only, unauthenticated" .-> IF_GQL
    WB_DOCS -. "reads docs/**.md at build time" .-> WB_ADMIN

    classDef comp fill:#f3f4f6,stroke:#6b7280,color:#1f2937
    classDef iface fill:#fef3c7,stroke:#d97706,color:#92400e
    class CL_UI,CL_TX,CL_DB,CL_NAT,GW_GQL,GW_AUTH,GW_STO,GW_AI,GW_DATA,AI_SUB,AI_PIPE,WB_ADMIN,WB_DOCS comp
    class IF_GQL,IF_AUTH,IF_S3,IF_JOB,IF_MSG,IF_MODEL,IF_SQL iface
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="component"
            chart={CHART}
            caption="Read an edge as “requires”."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>Two of these interfaces fail as wrong behaviour rather than as an exception: the Redis payload shape and the shared class IDs.</li>
                <li>web/ requires two interfaces nobody thinks of it as consuming — the Postgres schema and the S3 key layout.</li>
                <li>The mobile app requires the S3 key layout directly, because it PUTs to the presigned URL itself.</li>
            </ul>
        </DiagramShell>
    );
}
