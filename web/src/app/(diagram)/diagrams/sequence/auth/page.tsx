import { DiagramShell } from "@/components/diagram-shell";
import { Mermaid } from "@/components/mermaid";

const CHART_1 = `
sequenceDiagram
    autonumber
    participant U as User
    participant App as Mobile app
    participant GW as GraphQL resolver
    participant BA as Better Auth
    participant RL as Redis rate limit
    participant PG as Postgres
    participant Store as Auth store

    U->>App: Enter phone + password
    App->>GW: mutation login { phone, password, deviceLabel }
    GW->>BA: api.signInPhoneNumber({ phoneNumber, password })
    BA->>RL: consume(key) — fixed window, 5 / 15 min

    alt over budget
        RL-->>BA: denied + retryAfter (seconds)
        BA-->>GW: rate-limit error
        GW-->>App: HttpException 429<br/>extensions.retryAfterSec + Retry-After header
        App->>U: Inline error + countdown
    else within budget
        RL-->>BA: allowed
        BA->>PG: SELECT user by phone, verify accounts.password
        BA->>PG: INSERT user_sessions (token, expiresAt)
        BA-->>GW: { token, user }
        GW->>PG: label the session row with deviceLabel
        GW-->>App: AuthPayload { token, user }
        App->>Store: setAuthToken — SecureStore on native, AsyncStorage on web
        App->>U: Navigate home
    end
`;

const CHART_2 = `
sequenceDiagram
    autonumber
    participant App as Mobile app
    participant T as graphqlRequest
    participant GW as GqlAuthGuard
    participant BA as Better Auth
    participant Slice as Auth store
    participant LoginUI as Login screen

    Note over GW: Session revoked elsewhere<br/>(another device, admin action)

    App->>T: query me (Authorization: Bearer …)
    T->>GW: POST /graphql
    GW->>BA: api.getSession(headers) — bearer plugin reads the header
    BA-->>GW: session found, but is_active = false
    GW-->>T: UnauthorizedException →<br/>errorFormatter stamps extensions.code = UNAUTHENTICATED

    alt a token was actually sent
        T->>T: fireUnauthenticated()
        T->>Slice: the one registered handler runs
        Slice->>Slice: clearAuthToken + reset stores
        Slice->>LoginUI: Thai banner — session expired
        Slice-->>T: later 401s are no-ops
    else anonymous request (login, register)
        T-->>App: throw ApiError only — 401 here means "wrong credentials"
    end
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="sequence/auth"
            chart={CHART_1}
            caption="Login through Better Auth, with the throttle in front."
        >
            <h2>401 fan-out</h2>
            <Mermaid chart={CHART_2} caption="One 401, one handler, everywhere." className="not-prose my-6" />
            <h2>Worth knowing</h2>
            <ul>
                <li>The client never calls Better Auth&apos;s REST routes. It calls the GraphQL login mutation, and AuthService calls Better Auth in-process.</li>
                <li>extensions.code === &apos;UNAUTHENTICATED&apos; is a client-visible API. Renaming it either logs everyone out or stops logging them out.</li>
                <li>The fan-out only fires when a token was actually sent — a 401 on login means wrong credentials, not an expired session.</li>
            </ul>
        </DiagramShell>
    );
}
