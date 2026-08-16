import { DiagramShell } from "@/components/diagram-shell";

const CHART = `
erDiagram
    %% ── Identity (Better Auth owns these four) ──
    User ||--o{ Account : "credential + OAuth"
    User ||--o{ UserSession : "owns"
    User ||--o{ Passkey : "registers"
    User ||--o{ PushToken : "notified_on"

    %% ── Care relationships and audit ──
    User ||--o{ CaregiverPatient : "caregiver_of"
    User ||--o{ CaregiverPatient : "patient_of"
    User ||--o{ ProfileChangeLog : "subject_of"
    User ||--o{ ProfileChangeLog : "actor_of"

    %% ── Clinical data ──
    User ||--o{ BloodPressureReading : "records"
    User ||--o{ BloodPressureReading : "recorded_on_behalf"
    User ||--o{ Image : "uploads"
    User ||--o{ Alert : "receives"
    BloodPressureReading ||--o| Image : "captured_by"
    BloodPressureReading ||--o{ Alert : "triggers"

    %% ── Community ──
    User ||--o{ Post : "writes"
    User ||--o{ PostComment : "comments"
    User ||--o{ PostLike : "likes_post"
    User ||--o{ PostCommentLike : "likes_comment"
    Post ||--o{ PostComment : "has"
    Post ||--o{ PostLike : "has"
    PostComment ||--o{ PostCommentLike : "has"
    PostComment ||--o{ PostComment : "replies_to"

    User {
        uuid id PK
        string email UK "required — the proof account linking depends on"
        bool email_verified
        string name "Better Auth display name, 201 chars"
        string firstname
        string lastname
        string phone UK "NOT NULL — caregivers find patients by phone"
        bool phone_number_verified
        string password_hash "legacy bcrypt; Better Auth writes accounts.password"
        enum role "caregiver | developer | patient"
        timestamp role_selected_at "null = onboarding role step still due"
        string last_login_method "email | phone-number | google | passkey"
        bool banned
        string ban_reason
        timestamp ban_expires
        date dob
        enum gender "male | female | other"
        float weight
        float height
        string congenital_disease
        string avatar "mapped to Better Auth image"
        timestamp created_at
        timestamp updated_at
    }

    Account {
        uuid id PK
        string account_id "provider's own id"
        string provider_id "credential | google"
        uuid user_id FK
        string password "bcrypt hash when provider_id = credential"
        string access_token
        string refresh_token
        string id_token
        timestamp access_token_expires_at
        timestamp refresh_token_expires_at
        string scope
        timestamp created_at
        timestamp updated_at
    }

    UserSession {
        uuid id PK
        uuid user_id FK
        string token UK
        timestamp expires_at
        string ip_address
        string user_agent
        uuid impersonated_by "admin plugin"
        string device_label
        bool is_active "logout flips this; the guard's kill switch"
        timestamp revoked_at
        timestamp last_active_at
        timestamp created_at
        timestamp updated_at
    }

    Passkey {
        uuid id PK
        uuid user_id FK
        string credential_id UK
        string public_key
        int counter
        string device_type
        bool backed_up
        string transports
        string aaguid
        string name
        timestamp created_at
    }

    Verification {
        uuid id PK
        string identifier "email or phone the code was issued to"
        string value "OTP or token"
        timestamp expires_at
        timestamp created_at
        timestamp updated_at
    }

    PushToken {
        uuid id PK
        string token UK "ExponentPushToken[…] — unique across ALL users"
        uuid user_id FK
        string device_label
        string platform "ios | android"
        timestamp last_registered_at
        string pending_receipt_id "unresolved Expo delivery receipt"
        timestamp pending_receipt_at
        timestamp created_at
        timestamp updated_at
    }

    CaregiverPatient {
        uuid caregiver_id PK,FK
        uuid patient_id PK,FK
        enum relationship "parent | patient | caregiver | child | spouse"
        enum status "pending | accepted | rejected"
        enum permission "view | full — default full, revocable any time"
        timestamp created_at
        timestamp responded_at
    }

    ProfileChangeLog {
        uuid id PK
        uuid patient_id FK "cascade — the trail belongs to the record"
        uuid actor_id FK "SetNull — erasure must not erase the patient's trail"
        string actor_name "denormalised, survives actor deletion"
        string field "one row per field, not per request"
        string old_value "rendered text; null = genuinely unset"
        string new_value
        timestamp changed_at
    }

    BloodPressureReading {
        int id PK
        uuid user_id FK "whose reading it is"
        string client_id UK "offline dedupe seam, minted on device"
        uuid recorded_by_id FK "set only when someone else logged it"
        int systolic
        int diastolic
        int pulse
        enum status "low | normal | elevated | high | critical"
        timestamp measured_at "device clock, uncorrected"
        string notes
        timestamp created_at
        timestamp updated_at
    }

    Image {
        int id PK
        uuid user_id FK
        string s3_key UK "the analysis reply is keyed on this"
        int reading_id FK,UK "nullable + unique — at most one image per reading"
        string device_name
        float image_quality_score "written back by AiProcessor, provisional"
        timestamp uploaded_at
        timestamp updated_at
    }

    Alert {
        int id PK
        uuid user_id FK
        int bp_reading_id FK
        string alert_message
        enum alert_level "warning | critical"
        timestamp read_at
        timestamp created_at
        timestamp updated_at
    }

    Post {
        int id PK
        uuid user_id FK
        string client_id UK
        text content
        enum category "general | experience | qa"
        timestamp created_at
        timestamp updated_at
    }

    PostComment {
        int id PK
        int post_id FK
        uuid user_id FK
        int parent_id FK "null = top-level"
        text content
        timestamp created_at
        timestamp updated_at
    }

    PostLike {
        uuid user_id PK,FK
        int post_id PK,FK
        timestamp created_at
    }

    PostCommentLike {
        uuid user_id PK,FK
        int comment_id PK,FK
        timestamp created_at
    }
`;

export default function DiagramPage() {
    return (
        <DiagramShell
            slug="er"
            chart={CHART}
            caption="13 models, 8 enums — the gateway is the only writer."
        >
            <h2>Worth knowing</h2>
            <ul>
                <li>Four models are Better Auth&apos;s (User, Account, UserSession, Verification) and Passkey is the passkey plugin&apos;s.</li>
                <li>Credentials live on accounts.password; users.password_hash is the legacy bcrypt column kept until the backfill is verified.</li>
                <li>Image.reading_id is nullable and unique: an image exists before its reading, and at most one image per reading.</li>
            </ul>
        </DiagramShell>
    );
}
