import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
flowchart TB
    subgraph CLIENT["📦 client/ — Expo, the product"]
        direction TB
        C_APP["app/<br/>Expo Router routes"]
        C_MOD["modules/<br/>auth · capture · readings · caregivers ·<br/>community · security · notifications ·<br/>profile · onboarding · health-tips"]
        C_SVC["services/<br/>api · auth-token · session · upload-image"]
        C_DB["database/<br/>Drizzle + SQLite schema"]
        C_STORE["stores/<br/>Zustand: auth · preferences"]
        C_NATIVE["modules/bp-vision/ (project root!)<br/>Kotlin Expo module — YOLO + CRNN"]
        C_APP --> C_MOD
        C_MOD --> C_SVC
        C_MOD --> C_DB
        C_MOD --> C_STORE
        C_MOD --> C_NATIVE
    end

    subgraph GW["📦 server/app/api-gateway/ — NestJS"]
        direction TB
        G_AUTH["auth/<br/>Better Auth + guard"]
        G_READ["reading/ · alert/ · caregiver/ ·<br/>post/ · comment/ · push/ · security/"]
        G_AI["ai/<br/>resolver · service · processor"]
        G_STORE["storage/<br/>S3 presign + cleanup"]
        G_REDIS["redis/<br/>rate limit · secondary storage"]
        G_PRISMA["prisma/<br/>PrismaService + schema"]
        G_AUTH --> G_PRISMA
        G_AUTH --> G_REDIS
        G_READ --> G_PRISMA
        G_AI --> G_PRISMA
        G_AI --> G_REDIS
        G_AI --> G_STORE
        G_READ --> G_STORE
    end

    subgraph AI["📦 server/app/ai-service/ — FastAPI"]
        direction TB
        A_MAIN["main.py<br/>lifespan + /health"]
        A_HAND["handlers.py<br/>the only public surface"]
        A_PIPE["analyzer/pipeline.py"]
        A_YOLO["analyzer/yolo.py"]
        A_OCR["analyzer/ocr/<br/>crnn · ssocr · cnn_classifiers"]
        A_VAL["analyzer/validation.py · rectify.py ·<br/>preprocessing.py"]
        A_STOR["storage/fetch.py"]
        A_MAIN --> A_HAND
        A_HAND --> A_PIPE
        A_HAND --> A_STOR
        A_PIPE --> A_YOLO
        A_PIPE --> A_OCR
        A_PIPE --> A_VAL
    end

    subgraph WEB["📦 web/ — Next.js, team-only, NOT deployed"]
        direction TB
        W_DOCS["app/(docs)/<br/>renders docs/**.md"]
        W_DIAG["app/(diagram)/<br/>hand-written diagram pages"]
        W_ADMIN["app/admin/<br/>7 service-status pages"]
        W_LIB["lib/<br/>db · redis · s3 · ai-service · gateway · docs · tasks"]
        W_DOCS --> W_LIB
        W_DIAG --> W_LIB
        W_ADMIN --> W_LIB
    end

    subgraph CONTRACTS["🔗 Wire contracts — the only stable cross-app surfaces"]
        direction LR
        K_GQL["GraphQL schema<br/>src/schema.gql"]
        K_REDIS["analyze_bp_image<br/>+ .reply payloads"]
        K_S3["S3 key layout<br/>users/{id}/…"]
        K_MODEL["yolo11n.onnx<br/>+ 5 class IDs"]
    end

    subgraph DATA["🗄 Datastores"]
        direction LR
        D_PG[("Postgres")]
        D_RD[("Redis")]
        D_S3[("S3")]
    end

    C_SVC --> K_GQL
    K_GQL --> G_AUTH
    K_GQL --> G_READ
    K_GQL --> G_AI
    C_SVC --> K_S3
    C_NATIVE --> K_MODEL
    A_YOLO --> K_MODEL
    G_AI --> K_REDIS
    K_REDIS --> A_HAND
    G_STORE --> K_S3
    A_STOR --> K_S3

    G_PRISMA --> D_PG
    G_REDIS --> D_RD
    K_S3 --> D_S3

    W_LIB -. "own pg Pool" .-> D_PG
    W_LIB -. "own ioredis client" .-> D_RD
    W_LIB -. "own S3 client" .-> D_S3
    W_LIB -. "hello query only, no token" .-> K_GQL

    classDef client fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef gw fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
    classDef ai fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef web fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    classDef contract fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef data fill:#f3f4f6,stroke:#6b7280,color:#1f2937
    class C_APP,C_MOD,C_SVC,C_DB,C_STORE,C_NATIVE client
    class G_AUTH,G_READ,G_AI,G_STORE,G_REDIS,G_PRISMA gw
    class A_MAIN,A_HAND,A_PIPE,A_YOLO,A_OCR,A_VAL,A_STOR ai
    class W_DOCS,W_DIAG,W_ADMIN,W_LIB web
    class K_GQL,K_REDIS,K_S3,K_MODEL contract
    class D_PG,D_RD,D_S3 data
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="package"
            chart={CHART}
            caption="An arrow means “depends on at build or call time”."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>bp-vision lives at the project root rather than under src/, because Expo autolinking scans &lt;root&gt;/modules for local native modules.</li>
                <li>There is no shared types package. The DTOs on both sides of the Redis channel are hand-mirrored, and that is a deliberate trade.</li>
                <li>ai-service has exactly one public surface: handlers.py. Everything else is reachable only through it.</li>
            </ul>
        </DiagramShell>
    );
}
