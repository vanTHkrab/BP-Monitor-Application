import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `flowchart LR
    subgraph Mobile["📱 Mobile Client — Expo / React Native"]
        direction TB
        ZUSTAND["Zustand Store<br/>optimistic writes"]
        SQLITE[("SQLite<br/>pending_readings<br/>queue + mirror")]
        YOLOC["On-device YOLOv11n<br/>pre-flight gate"]
        ZUSTAND --> SQLITE
        ZUSTAND --> YOLOC
    end

    subgraph Gateway["🟣 API Gateway — NestJS + Mercurius"]
        direction TB
        GQL["GraphQL Resolvers"]
        AUTHG["Auth + Sessions<br/>JWT, login throttle"]
        AIBRIDGE["AI Bridge<br/>ai.process.ts"]
        PRESIGN["Storage<br/>S3 presign + cron"]
        PRISMA["PrismaService<br/>sole Postgres writer"]
        GQL --> AUTHG
        GQL --> AIBRIDGE
        GQL --> PRESIGN
        GQL --> PRISMA
    end

    subgraph AIService["🟢 AI Service — FastAPI / Python"]
        direction TB
        SUB["Redis subscriber<br/>handlers.py"]
        YOLOA["YOLOv11n Detector<br/>same .onnx as client"]
        OCR["OCR Pipeline"]
        SUB --> YOLOA --> OCR
    end

    subgraph DataLayer["⚪ Data Layer"]
        direction TB
        PG[("PostgreSQL<br/>durable state")]
        REDIS{{"Redis<br/>pub/sub transport"}}
        S3[("S3-compatible storage<br/>images + JSONL metrics")]
    end

    ZUSTAND -- "GraphQL + token auth" --> GQL
    SQLITE -. "reconcile on next fetchX" .-> GQL
    ZUSTAND -- "presign request, then direct PUT" --> S3

    AUTHG --> REDIS
    PRESIGN --> S3
    PRISMA --> PG
    AIBRIDGE -- "PUBLISH analyze_bp_image" --> REDIS
    REDIS -- "SUBSCRIBE analyze_bp_image" --> SUB
    SUB -- "PUBLISH analyze_bp_image.reply" --> REDIS
    REDIS -- "SUBSCRIBE reply" --> AIBRIDGE
    YOLOA -- "presigned GET" --> S3
    OCR -- "presigned GET" --> S3

    classDef client fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px
    classDef gw fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px
    classDef ai fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px
    classDef data fill:#f3f4f6,stroke:#6b7280,color:#1f2937,stroke-width:2px
    class ZUSTAND,SQLITE,YOLOC client
    class GQL,AUTHG,AIBRIDGE,PRESIGN,PRISMA gw
    class SUB,YOLOA,OCR ai
    class PG,REDIS,S3 data

    style Mobile fill:#eff6ff,stroke:#93c5fd,stroke-width:1px
    style Gateway fill:#f5f3ff,stroke:#c4b5fd,stroke-width:1px
    style AIService fill:#f0fdf4,stroke:#86efac,stroke-width:1px
    style DataLayer fill:#f9fafb,stroke:#d1d5db,stroke-width:1px
`;

export default function ArchitecturePage() {
    return (
        <DiagramPage
            title="System Architecture"
            subtitle="How the mobile client, gateway, AI service, and data layer talk to each other"
            description="The mobile client speaks GraphQL to one NestJS gateway, which owns Postgres via Prisma and bridges to the FastAPI AI service over a Redis pub/sub contract. Media bytes flow client → S3 directly via presigned PUT."
            tags={["Architecture", "End-to-end"]}
        >
            <DiagramSection
                title="The full picture"
                description="Edges are direct calls or pub/sub hops. Postgres is the only durable store; Redis is a transport, not a database; SQLite on mobile is a queue + mirror, not authority."
            >
                <Mermaid chart={chart} />
            </DiagramSection>

            <DiagramSection title="Key insights" description="What a reviewer should take away first.">
                <InsightList
                    items={[
                        {
                            label: "One gateway, one client",
                            detail:
                                "The mobile app hits the GraphQL endpoint with a token auth scheme. Any breaking schema change ships straight to the patient-facing client.",
                        },
                        {
                            label: "Redis is the only AI contract",
                            detail:
                                "Channels analyze_bp_image and analyze_bp_image.reply, with payload shapes owned by api-gateway/src/ai/ai.process.ts and mirrored by ai-service/src/ai_service/handlers.py. Both sides must change together.",
                        },
                        {
                            label: "S3 is direct from the mobile client",
                            detail:
                                "BP images and avatars PUT straight to S3 via a presigned URL the gateway hands out (client/services/camera.service.ts, client/utils/upload-image.ts). Bytes never tunnel through the gateway, so it doesn't become an upload bottleneck.",
                        },
                        {
                            label: "Redis is optional at boot",
                            detail:
                                "The gateway lazy-connects and degrades to an in-memory throttle and a disabled AI path if Redis is down. AI features fail soft; auth keeps working.",
                        },
                    ]}
                />
            </DiagramSection>

            <DiagramSection
                title="Design trade-offs"
                description="Choices that look ordinary but lock in behavior."
            >
                <InsightList
                    items={[
                        {
                            label: "No shared types package",
                            detail:
                                "GraphQL schema + Redis payload + S3 key layout are the only stable cross-process surfaces. Cost: hand-mirrored DTOs on both sides of the AI channel. Benefit: each service ships independently without a build-time coupling.",
                        },
                        {
                            label: "Asymmetric latency budgets",
                            detail:
                                "UI calls must feel synchronous; AI analysis is async, poll-based. Anything that blocks a screen on the AI path is treated as a regression.",
                        },
                        {
                            label: "Postgres as the only source of truth",
                            detail:
                                "SQLite (mobile) and Redis (transport) are caches/queues, not authority. The mobile store writes optimistically, queues to SQLite (pending_readings) on failure, and reconciles on the next fetchX call; we accept some staleness for offline resilience.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
