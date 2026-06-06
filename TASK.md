# BP Monitor — Task Board

_Last updated: 2026-06-06 · Updated by bp-task_

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
- [~] **C-004** `high` Integrate on-device YOLO pre-flight result into camera UI warning banner

### web

- [ ] **W-001** `high` Build clinician dashboard: reading list with BP-status filter
- [ ] **W-002** `medium` Add patient search and profile page
- [ ] **W-003** `low` Export readings as CSV from the web dashboard

### api-gateway

- [ ] **A-001** `high` Add pagination to `readings` GraphQL query
- [ ] **A-002** `medium` Rate-limit the `uploadBPImage` mutation per user
- [ ] **A-003** `low` Expose a `healthz` endpoint for the infra liveness probe

### ai-service

- [ ] **AI-001** `high` Replace stub OCR with full SYS / DIA / pulse extraction pipeline
- [ ] **AI-002** `medium` Return confidence scores per field in the analysis reply payload
- [ ] **AI-003** `low` Add structured logging for every Redis message received and sent

### infra

- [ ] **I-001** `medium` Add a `staging` compose profile that mirrors prod minus S3
- [ ] **I-002** `low` Add healthcheck stanzas to all services in docker-compose.yml

---

## Blocked

<!-- Tasks that cannot proceed until an external dependency is resolved. -->
<!-- Format: - [!] **ID** `priority` description — blocked: <reason> -->
