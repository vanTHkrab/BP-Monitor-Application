import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const loginChart = `sequenceDiagram
    autonumber
    participant U as User
    participant App as Mobile App
    participant GW as API Gateway
    participant Throttle as Redis Throttle
    participant PG as Postgres
    participant Store as Auth Slice

    U->>App: Enter phone + password
    App->>GW: mutation login { phone, password }
    GW->>Throttle: INCR loginCount(phone)
    alt within window > 5 attempts
        Throttle-->>GW: blocked
        GW-->>App: 429 + extensions.retryAfterSec + Retry-After header
        App->>U: Inline error + countdown
    else under threshold
        Throttle-->>GW: allowed
        GW->>PG: SELECT user by phone
        GW->>GW: bcrypt.compare(password, hash)
        GW->>PG: INSERT user_session
        GW-->>App: { token, user, session }
        App->>Store: setAuthToken (SecureStore on native, AsyncStorage on web)
        App->>U: Navigate to home
    end
`;

const fanoutChart = `sequenceDiagram
    autonumber
    participant App as Mobile App
    participant T as GraphQL Transport
    participant GW as API Gateway
    participant Slice as Auth Slice
    participant LoginUI as Login Screen

    Note over GW: Session revoked elsewhere<br/>(logout on web, admin action)

    App->>T: query me (with token)
    T->>GW: POST /graphql
    GW->>GW: GqlAuthGuard sees isActive=false
    GW-->>T: 401 + extensions.code=UNAUTHENTICATED
    T->>T: fireUnauthenticated() (idempotent)
    T->>Slice: handleSessionExpired()
    Slice->>Slice: clearAuthToken + reset slices
    Slice->>LoginUI: Show Thai banner: session expired
    Slice-->>T: subsequent 401s become no-ops
`;

export default function AuthSequencePage() {
    return (
        <DiagramPage
            title="Auth & 401 Fan-out"
            subtitle="Token-based auth with global session-expired handling"
            description="There is no session cookie. Login mints a JWT bound to a UserSession row; every authenticated request validates the row is still active. Any 401 from any GraphQL transport fans out to a single auth-slice handler that wipes local state and surfaces a Thai banner — no per-slice 401 handling."
            tags={["Sequence", "Auth"]}
        >
            <DiagramSection
                title="Login + throttle"
                description="The login throttle is Redis-backed (5 attempts / 15 min / phone) with an in-memory fallback if Redis is down."
            >
                <Mermaid chart={loginChart} />
            </DiagramSection>

            <DiagramSection
                title="401 fan-out"
                description="One handler, many transports. New transports must call fireUnauthenticated() too — or session revocation from another device won't propagate."
            >
                <Mermaid chart={fanoutChart} />
            </DiagramSection>

            <DiagramSection title="Why this shape">
                <InsightList
                    items={[
                        {
                            label: "JWT + revocable session row",
                            detail:
                                "Stateless token convenience, but with a server-side kill switch. Logout flips isActive=false rather than deleting the row, so the sessions screen can show history.",
                        },
                        {
                            label: "Single handler for all 401s",
                            detail:
                                "Both graphqlRequest (constants/api.ts) and gqlRequest / gqlUpload (lib/graphql-client.ts) call the same fireUnauthenticated(). The auth slice registers the handler at composition time; the call is idempotent.",
                        },
                        {
                            label: "Retry-After is dual-channel",
                            detail:
                                "Throttle returns retryAfterSec inside extensions and also sets a real Retry-After header so proxies and naive clients still cooperate.",
                        },
                        {
                            label: "Token storage straddles platforms",
                            detail:
                                "SecureStore on native, AsyncStorage on web. Always go through setAuthToken / getAuthToken / clearAuthToken — never touch storage directly.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
