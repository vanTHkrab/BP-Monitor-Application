---
title: ER Diagram (Prisma schema)
description: >-
    Postgres tables and relations as Prisma sees them. The gateway is the only
    writer to Postgres. Every relation here is enforced at the DB level via
    Prisma. UUIDs for users (so clients can generate them offline if needed);
    auto-increment ints for everything else.
status: current
updated: 2026-08-06
owner: api-gateway
---

## Full schema

Source of truth: server/app/api-gateway/prisma/schema.prisma.

```mermaid
erDiagram
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

    User ||--o{ ProfileChangeLog : "subject_of"
    User ||--o{ ProfileChangeLog : "actor_of"

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
        enum permission "view|full"
        timestamp created_at
        timestamp responded_at
    }

    ProfileChangeLog {
        uuid id PK
        uuid patient_id FK "whose record"
        uuid actor_id FK "who changed it; null once their account is deleted"
        string actor_name "snapshot at write time"
        string field "one of dob|gender|weight|height|congenital_disease"
        string old_value "rendered text; null means unset"
        string new_value "rendered text; null means cleared"
        timestamp changed_at
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
```

## Things worth a second look

- **client_id on readings and posts** — Unique nullable string from the mobile
  client (createClientId). The dedupe seam between offline create and server
  insert — re-syncing the same local row never creates a duplicate.
- **Image.reading_id is nullable + unique** — An image can exist before its
  reading row (uploaded during capture, attached on confirm) but at most one
  reading per image. SetNull on delete keeps history rather than cascading.
- **CaregiverPatient is self-relation on User** — Composite PK (caregiver_id,
  patient_id). The same row pairs a caregiver and a patient with a typed
  relationship. Cascades on either side delete the link, not the people.
  `permission` (`view` | `full`, default `full`) is what an *accepted* link
  grants: `full` covers recording readings on the patient's behalf and
  editing their health information, and the patient can move it either way at
  any time via `updateCaregiverPermission`.
- **ProfileChangeLog is the audit for that second power** — One row per field
  changed, not per request, so "weight 60 → 80, by whom, when" is a row rather
  than a diff someone has to reconstruct. Values are stored as rendered text
  because the five editable fields span four types and the consumer is a human
  reading a list; `null` on either side distinguishes unset from cleared.
  `patient_id` cascades — the trail belongs to the record it describes — but
  `actor_id` is `SetNull` with a denormalised `actor_name` beside it, so
  deleting a caregiver's account cannot erase the patient's record of what
  that caregiver did. `Restrict` was the alternative and is worse: it would
  make an audit row a permanent block on the actor's right to erasure. Only
  the patient can read their own trail; there is deliberately no
  caregiver-facing query, because every row carries the patient's health
  values and revocation has to be complete.
- **user_sessions, not session cookies** — Every authenticated request
  validates the session row exists with is_active=true. Logout flips the flag;
  sessions table is also the data behind the device-history screen.
- **PostComment.parent_id self-relation** — Threaded replies one level deep are
  modelled with parent_id pointing back to PostComment. parent_id IS NULL means
  top-level.
