import {
    DiagramPage,
    DiagramSection,
    InsightList,
} from "@/components/diagram-page";
import { Mermaid } from "@/components/mermaid";

const chart = `erDiagram
    User ||--o{ UserSession : "owns"
    User ||--o{ BloodPressureReading : "records"
    User ||--o{ Image : "uploads"
    User ||--o{ Alert : "receives"
    User ||--o{ Post : "writes"
    User ||--o{ PostComment : "comments"
    User ||--o{ PostLike : "likes_post"
    User ||--o{ PostCommentLike : "likes_comment"

    User ||--o{ CaregiverPatient : "caregiver_of"
    User ||--o{ CaregiverPatient : "patient_of"

    BloodPressureReading ||--o| Image : "captured_by"
    BloodPressureReading ||--o{ Alert : "triggers"

    Post ||--o{ PostComment : "has"
    Post ||--o{ PostLike : "has"
    PostComment ||--o{ PostCommentLike : "has"
    PostComment ||--o{ PostComment : "replies_to"

    User {
        uuid id PK
        string email UK
        string phone UK
        string firstname
        string lastname
        string password_hash
        enum role "caregiver|developer|patient"
        date dob
        enum gender
        float weight
        float height
        string congenital_disease
        string avatar
        timestamp created_at
        timestamp updated_at
    }

    UserSession {
        uuid id PK
        uuid user_id FK
        string device_label
        string user_agent
        bool is_active
        timestamp revoked_at
        timestamp last_active_at
        timestamp created_at
    }

    CaregiverPatient {
        uuid caregiver_id PK,FK
        uuid patient_id PK,FK
        enum relationship "parent|patient|caregiver|child|spouse|sibling|friend|caregiver_professional|other"
        enum status "pending|accepted|rejected"
        timestamp created_at
        timestamp responded_at
    }

    BloodPressureReading {
        int id PK
        uuid user_id FK
        string client_id UK "offline-first dedupe"
        int systolic
        int diastolic
        int pulse
        enum status "low|normal|elevated|high|critical"
        timestamp measured_at
        string notes
        timestamp created_at
        timestamp updated_at
    }

    Image {
        int id PK
        uuid user_id FK
        string s3_key UK
        string device_name
        float image_quality_score
        int reading_id FK,UK "null until linked"
        timestamp uploaded_at
        timestamp updated_at
    }

    Alert {
        int id PK
        uuid user_id FK
        int bp_reading_id FK
        string alert_message
        enum alert_level "warning|critical"
        timestamp read_at
        timestamp created_at
        timestamp updated_at
    }

    Post {
        int id PK
        uuid user_id FK
        string client_id UK
        text content
        enum category "general|experience|qa"
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

export default function ErPage() {
    return (
        <DiagramPage
            title="ER Diagram (Prisma schema)"
            subtitle="Postgres tables and relations as Prisma sees them"
            description="The gateway is the only writer to Postgres. Every relation here is enforced at the DB level via Prisma. UUIDs for users (so clients can generate them offline if needed); auto-increment ints for everything else."
            tags={["Data model", "Prisma"]}
        >
            <DiagramSection
                title="Full schema"
                description="Source of truth: server/app/api-gateway/prisma/schema.prisma."
            >
                <Mermaid chart={chart} />
            </DiagramSection>

            <DiagramSection title="Things worth a second look">
                <InsightList
                    items={[
                        {
                            label: "client_id on readings and posts",
                            detail:
                                "Unique nullable string from the mobile client (createClientId). The dedupe seam between offline create and server insert — re-syncing the same local row never creates a duplicate.",
                        },
                        {
                            label: "Image.reading_id is nullable + unique",
                            detail:
                                "An image can exist before its reading row (uploaded during capture, attached on confirm) but at most one reading per image. SetNull on delete keeps history rather than cascading.",
                        },
                        {
                            label: "CaregiverPatient is self-relation on User",
                            detail:
                                "Composite PK (caregiver_id, patient_id). The same row pairs a caregiver and a patient with a typed relationship. Cascades on either side delete the link, not the people.",
                        },
                        {
                            label: "user_sessions, not session cookies",
                            detail:
                                "Every authenticated request validates the session row exists with is_active=true. Logout flips the flag; sessions table is also the data behind the device-history screen.",
                        },
                        {
                            label: "PostComment.parent_id self-relation",
                            detail:
                                "Threaded replies one level deep are modelled with parent_id pointing back to PostComment. parent_id IS NULL means top-level.",
                        },
                    ]}
                />
            </DiagramSection>
        </DiagramPage>
    );
}
