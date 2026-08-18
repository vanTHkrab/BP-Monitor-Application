import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
flowchart TB
    subgraph DEV["🧪 Dev — docker-compose.yml + .dev.yml"]
        direction TB
        DEV_WEB["web:3000<br/>Next.js dev server"]
        DEV_GW["api-gateway:3000<br/>pnpm start:dev, bind-mounted"]
        DEV_AI["ai-service:8000<br/>fastapi dev"]
        DEV_PG[("postgres:5432<br/>volume postgres_data")]
        DEV_RD[("redis:6379<br/>appendonly, volume redis_data")]
        DEV_WEB -. "direct pg / redis / s3 / http" .-> DEV_PG
        DEV_WEB -.-> DEV_RD
        DEV_GW --> DEV_PG
        DEV_GW --> DEV_RD
        DEV_AI --> DEV_RD
    end

    subgraph PROD["🎯 Prod-shaped rehearsal — + .prod.yml"]
        direction TB
        P_CF["cloudflared<br/>the only ingress, outbound-only"]
        P_NG["nginx :80 (expose, not publish)<br/>envsubst templates + 6 h reload loop<br/>Basic Auth on /graphiql"]
        P_GW["api-gateway :3000 (expose)<br/>build target: prod"]
        P_AI["ai-service<br/>NO port, NO nginx route"]
        P_PG[("postgres")]
        P_RD[("redis")]
        P_CF --> P_NG
        P_NG --> P_GW
        P_GW --> P_PG
        P_GW --> P_RD
        P_AI --> P_RD
        P_NOTE["web: not defined here —<br/>an override cannot remove a service,<br/>so it lives only in .dev.yml"]
    end

    subgraph QUADLET["🚀 Intended production — infra/podman/ Quadlet on EC2"]
        direction TB
        Q_CF["bp-cloudflared.container"]
        Q_NG["bp-nginx.container<br/>same config files, reused verbatim"]
        Q_GW["bp-api-gateway.container"]
        Q_AI["bp-ai-service.container"]
        Q_RD[("bp-redis.container<br/>+ bp-redis-data.volume")]
        Q_PG[("Supabase — off-box, managed")]
        Q_MIG["bp-migrate.service<br/>manual gate, Prisma migrations"]
        Q_CF --> Q_NG
        Q_NG --> Q_GW
        Q_GW --> Q_RD
        Q_GW --> Q_PG
        Q_AI --> Q_RD
        Q_MIG -.-> Q_PG
    end

    INTERNET(("Internet")) --> CFEDGE["Cloudflare edge<br/>TLS terminates here"]
    CFEDGE -. "tunnel, no inbound port" .-> P_CF
    CFEDGE -. "tunnel, no inbound port" .-> Q_CF
    S3EXT[("S3-compatible object storage<br/>external in every runtime")]
    P_GW --> S3EXT
    P_AI --> S3EXT
    Q_GW --> S3EXT
    Q_AI --> S3EXT
    DEV_GW --> S3EXT

    classDef dev fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef prod fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
    classDef quad fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef note fill:#fef3c7,stroke:#d97706,color:#92400e
    class DEV_WEB,DEV_GW,DEV_AI,DEV_PG,DEV_RD dev
    class P_CF,P_NG,P_GW,P_AI,P_PG,P_RD prod
    class Q_CF,Q_NG,Q_GW,Q_AI,Q_RD,Q_PG,Q_MIG quad
    class P_NOTE note
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="deployment"
            chart={CHART}
            caption="Three runtimes, same images, shrinking surface left to right."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>Nothing publishes a host port in the two right-hand stacks. The only ingress is an outbound Cloudflare Tunnel connector.</li>
                <li>ai-service has no published port and no nginx route in any deployed stack; its only caller is api-gateway over Redis.</li>
                <li>The Quadlet column is a reviewed design, not an observed runtime — its own README states nothing there has ever been executed.</li>
            </ul>
        </DiagramShell>
    );
}
