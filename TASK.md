# BP Monitor — Task Board

_Last updated: 2026-08-06 · Updated by bp-task_

## Imports

<!-- bp-task resolves these at read time. Tasks from imported files are merged
     into the board with their scope prefix. Duplicates are skipped. -->
@client/PLAN.md

---

## Tasks

### client

- [ ] **C-001** `high` Wire caregiver push-notification preference screen to the store
- [ ] **C-002** `medium` Add 7-day BP trend chart to the history tab
- [ ] **C-003** `medium` Implement PIN / biometric lock for the app-open flow
- [x] **C-004** `high` Integrate on-device YOLO pre-flight result into camera UI warning banner — closed 2026-08-06 as superseded, not implemented: the live framing gate replaced the warning-banner design and already shipped (`docs/todo/CLIENT-remaining.md` §10)
- [ ] **C-005** `medium` Restore the caregiver "ดูข้อมูล" jump from invitations into a patient's readings — ship with the home/history tab port; `client/src/app/invitations.tsx` should set the viewing context in `client/src/modules/caregivers/`, not the auth store (see `docs/todo/CLIENT-auth-structure.md`, "activePatientId")
- [ ] **C-006** `medium` Stop `formatErrorMessage` leaking English into user-facing errors — `client/src/services/api.ts:107` prepends `"<OperationName> failed: "`, and `stripCode` in `client/src/lib/error-message.ts:23` is anchored (`/^\s*\[[A-Z_]+\]\s*/`) so it never strips the code; affects all six call sites (post, invitations ×3, post/[id] ×2, readings, community) — preferred fix is dropping the operation-name prefix, since it is developer data

### web

- [ ] **W-001** `high` Build clinician dashboard: reading list with BP-status filter
- [ ] **W-002** `medium` Add patient search and profile page
- [ ] **W-003** `low` Export readings as CSV from the web dashboard

### api-gateway

- [ ] **A-001** `high` Add pagination to `readings` GraphQL query
- [ ] **A-002** `medium` Rate-limit the `uploadBPImage` mutation per user
- [ ] **A-003** `low` Expose a `healthz` endpoint for the infra liveness probe
- [ ] **A-004** `medium` Fix `addCaregiverPatient`'s unusable default relationship — `schema.gql:380` defaults `relationship` to `"caregiver"`, which is absent from `VALID_RELATIONSHIPS` (`caregiver.service.ts:34`), so `parseRelationship` stores `other`; Prisma's `RelationshipType` has both `caregiver` and `patient` — pick the authoritative set and make the default a member of it
- [x] **A-005** `medium` Let a caregiver find a patient by email as well as phone in `addCaregiverPatient` — done 2026-08-06, both sides: the mutation argument is now the polymorphic `patientContact` (contains `@` ⇒ email, else phone; no `patientPhone` alias — the `CaregiverLinkType.patientPhone` _field_ is unchanged), and the client sends it from one untoggled input backed by `client/src/modules/caregivers/lib/contact.ts`
- [ ] **A-006** `medium` Normalise `email` in `AuthService.updateProfile` — `server/app/api-gateway/src/auth/auth.service.ts:297` patches it straight through Prisma, bypassing Better Auth's lowercasing; no bad rows today (15 users, 0 where `email <> lower(email)`) but a mixed-case row written here is invisible to A-005's `findUnique` email lookup, so the fix belongs at the write, not the read
- [ ] **A-007** `high` Rate-limit `addCaregiverPatient` — it has none, and now that the email branch exists the honest `ไม่พบผู้ใช้จากอีเมลนี้` is account enumeration against addresses far easier to guess than Thai phone numbers; keeping the honest message was an explicit user decision, so throttling is the mitigation — `login-throttle.guard.ts`'s Lua pattern is the template

### ai-service

- [x] **AI-001** `high` Replace stub OCR with full SYS / DIA / pulse extraction pipeline
- [x] **AI-002** `medium` Return confidence scores per field in the analysis reply payload
- [ ] **AI-003** `low` Add structured logging for every Redis message received and sent

### infra

- [ ] **I-001** `medium` Add a `staging` compose profile that mirrors prod minus S3
- [ ] **I-002** `low` Add healthcheck stanzas to all services in docker-compose.yml

---

## Blocked

<!-- Tasks that cannot proceed until an external dependency is resolved. -->
<!-- Format: - [!] **ID** `priority` description — blocked: <reason> -->
