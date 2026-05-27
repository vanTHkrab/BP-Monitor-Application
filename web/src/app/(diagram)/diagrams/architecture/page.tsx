import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `graph LR
    subgraph Clients
        M["Expo Mobile App<br/>(React Native + SQLite queue)"]
        W["Web Dashboard<br/>(Next.js App Router)"]
    end

    subgraph Backend["API Gateway (NestJS + Mercurius)"]
        G["GraphQL Resolvers"]
        AUTH["Auth + Sessions<br/>(JWT, login throttle)"]
        AI["AI Bridge<br/>(src/ai/)"]
        STORAGE["Storage<br/>(presign + cleanup cron)"]
        PRISMA["PrismaService"]
    end

    subgraph Infra["Shared Infrastructure"]
        PG[("PostgreSQL<br/>(durable state)")]
        REDIS[("Redis<br/>(pub/sub + throttle)")]
        S3[("S3<br/>(images + metrics)")]
    end

    subgraph AIService["AI Service (FastAPI, Python)"]
        LISTENER["Redis Listener"]
        YOLO["YOLOv12n Detector"]
        OCR["OCR Pipeline"]
    end

    M -- "GraphQL + multipart upload" --> G
    W -- "GraphQL" --> G
    M -- "PUT signed URL" --> S3
    W -- "PUT signed URL" --> S3

    G --> AUTH
    G --> AI
    G --> STORAGE
    G --> PRISMA
    PRISMA --> PG
    AUTH --> REDIS
    STORAGE --> S3

    AI -- "publish analyze_bp_image" --> REDIS
    REDIS -- "subscribe analyze_bp_image" --> LISTENER
    LISTENER --> YOLO
    LISTENER --> OCR
    YOLO -- "presigned GET" --> S3
    OCR -- "presigned GET" --> S3
    LISTENER -- "publish analyze_bp_image.reply" --> REDIS
    REDIS -- "subscribe reply" --> AI

    classDef client fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
    classDef gw fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef infra fill:#e5e7eb,stroke:#6b7280,color:#1f2937
    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#5b21b6
    class M,W client
    class G,AUTH,AI,STORAGE,PRISMA gw
    class PG,REDIS,S3 infra
    class LISTENER,YOLO,OCR ai
`;

export default function ArchitecturePage() {
    return (
        <DiagramPage
            title="System Architecture"
            subtitle="How the four runtimes talk to each other"
            description="Two clients (mobile + web) speak GraphQL to one NestJS gateway, which owns Postgres via Prisma and bridges to the FastAPI AI service over a Redis pub/sub contract. Media bytes live in S3 and are never tunnelled through the gateway."
            tags={["Architecture", "End-to-end"]}
        >
            <DiagramSection
                title="The full picture"
                description="Solid arrows are direct calls. Pub/sub edges are explicit. Postgres is the only durable store; Redis is a transport, not a database."
            >
                <Mermaid chart={chart} />
            </DiagramSection>

            <DiagramSection title="Key insights" description="What a reviewer should take away first.">
                <InsightList
                    items={[
                        {
                            label: "One gateway, multiple clients",
                            detail:
                                "Mobile and web hit the same GraphQL endpoint with the same auth scheme. Any breaking schema change ships to two clients simultaneously.",
                        },
                        {
                            label: "Redis is the only AI contract",
                            detail:
                                "Channels analyze_bp_image and analyze_bp_image.reply, with payload shapes owned by api-gateway/src/ai/ and mirrored by ai-service/src/ai_service. Both sides must change together.",
                        },
                        {
                            label: "S3 is direct from client",
                            detail:
                                "Clients PUT to S3 via presigned URLs the gateway hands out. Bytes never tunnel through the gateway, so it doesn't become an upload bottleneck.",
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
                                "SQLite (mobile) and Redis (transport) are caches/queues, not authority. Reconciliation is on the next fetchX call; we accept some staleness for offline resilience.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
