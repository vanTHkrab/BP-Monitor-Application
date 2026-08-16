import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
flowchart LR
    subgraph Mobile["📱 Mobile Client — Expo / React Native"]
        direction TB
        ZUSTAND["Zustand stores<br/>auth + preferences"]
        SQLITE[("SQLite (Drizzle)<br/>pending_readings outbox<br/>readings mirror")]
        VISION["bp-vision (Kotlin)<br/>YOLOv11n + CRNN<br/>Android only"]
        ZUSTAND --> SQLITE
        ZUSTAND --> VISION
    end

    subgraph Gateway["🟣 API Gateway — NestJS + Fastify + Mercurius"]
        direction TB
        GQL["GraphQL resolvers"]
        AUTHG["Better Auth<br/>bearer + passkey + OTP"]
        QUEUE["AiService<br/>BullMQ producer"]
        WORKER["AiProcessor<br/>BullMQ worker"]
        PRESIGN["StorageModule<br/>S3 presign + sweeper"]
        PRISMA["PrismaService<br/>sole Postgres writer"]
        GQL --> AUTHG
        GQL --> QUEUE
        GQL --> PRESIGN
        GQL --> PRISMA
        QUEUE --> WORKER
        WORKER --> PRISMA
    end

    subgraph AIService["🟢 AI Service — FastAPI / Python"]
        direction TB
        SUB["Redis subscriber<br/>handlers.py"]
        YOLOA["YoloDetector<br/>same yolo11n.onnx"]
        OCRP["Pipeline<br/>rectify → OCR → validate"]
        SUB --> YOLOA --> OCRP
    end

    subgraph DataLayer["⚪ Data layer"]
        direction TB
        PG[("PostgreSQL<br/>durable state")]
        REDIS{{"Redis<br/>BullMQ + pub/sub<br/>rate limit + session store"}}
        S3[("S3-compatible storage<br/>images + JSONL metrics")]
    end

    ZUSTAND -- "GraphQL + bearer token" --> GQL
    SQLITE -. "drain outbox, then reconcile mirror" .-> GQL
    VISION -. "offline read, no network" .-> SQLITE
    ZUSTAND -- "presigned PUT, bytes skip the gateway" --> S3

    AUTHG --> REDIS
    PRESIGN --> S3
    PRISMA --> PG
    QUEUE -- "add job — queue ai-analysis" --> REDIS
    REDIS -- "reserve job" --> WORKER
    WORKER -- "PUBLISH analyze_bp_image" --> REDIS
    REDIS -- "SUBSCRIBE analyze_bp_image" --> SUB
    SUB -- "PUBLISH analyze_bp_image.reply" --> REDIS
    REDIS -- "SUBSCRIBE reply" --> WORKER
    YOLOA -- "presigned GET" --> S3
    OCRP -- "presigned GET" --> S3

    classDef client fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px
    classDef gw fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px
    classDef ai fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px
    classDef data fill:#f3f4f6,stroke:#6b7280,color:#1f2937,stroke-width:2px
    class ZUSTAND,SQLITE,VISION client
    class GQL,AUTHG,QUEUE,WORKER,PRESIGN,PRISMA gw
    class SUB,YOLOA,OCRP ai
    class PG,REDIS,S3 data

    style Mobile fill:#eff6ff,stroke:#93c5fd,stroke-width:1px
    style Gateway fill:#f5f3ff,stroke:#c4b5fd,stroke-width:1px
    style AIService fill:#f0fdf4,stroke:#86efac,stroke-width:1px
    style DataLayer fill:#f9fafb,stroke:#d1d5db,stroke-width:1px
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="architecture"
            chart={CHART}
            caption="Edges are direct calls, queue hops, or pub/sub hops."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>The AI path is two hops, not one: the resolver enqueues a BullMQ job, and a worker in the same process makes the Redis request/reply call.</li>
                <li>Redis is not just a transport here — BullMQ jobs, the rate limiter, and Better Auth&apos;s secondary session storage all live in it.</li>
                <li>web/ is absent on purpose: it is a fifth consumer of the datastores rather than a gateway client, and it is not deployed.</li>
            </ul>
        </DiagramShell>
    );
}
