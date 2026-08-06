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
- [x] **A-004** `medium` Fix `addCaregiverPatient`'s unusable default relationship — already done in the code when this was audited on 2026-08-06: `VALID_RELATIONSHIPS` in `caregiver.service.ts` contains `caregiver`, with a comment recording exactly this bug (the schema default failed its own check and every invite relying on it was silently stored as `other`). The set was widened rather than the default changed, so existing clients keep working; `patient` stays out, because the column describes the caregiver's relationship _to_ the patient. Closed as already-implemented, not newly fixed
- [x] **A-005** `medium` Let a caregiver find a patient by email as well as phone in `addCaregiverPatient` — done 2026-08-06, both sides: the mutation argument is now the polymorphic `patientContact` (contains `@` ⇒ email, else phone; no `patientPhone` alias — the `CaregiverLinkType.patientPhone` _field_ is unchanged), and the client sends it from one untoggled input backed by `client/src/modules/caregivers/lib/contact.ts`
- [ ] **A-006** `medium` Normalise `email` in `AuthService.updateProfile` — `server/app/api-gateway/src/auth/auth.service.ts:297` patches it straight through Prisma, bypassing Better Auth's lowercasing; no bad rows today (15 users, 0 where `email <> lower(email)`) but a mixed-case row written here is invisible to A-005's `findUnique` email lookup, so the fix belongs at the write, not the read
- [x] **A-007** `high` Rate-limit `addCaregiverPatient` — done 2026-08-06: 10 attempts / 10 min, keyed on the **caregiver's user id** (keying on the contact string would let an attacker rotate addresses and never spend a budget) and counting every attempt, found or not. The honest `ไม่พบผู้ใช้จากอีเมลนี้` stays, as decided in A-005; this is its mitigation. The INCR + PEXPIRE Lua that used to live in `login-throttle.guard.ts` now lives in `server/app/api-gateway/src/redis/rate-limit.service.ts` — extracted out of `auth/better-auth.ts`, where Better Auth had inherited it, and covered by tests first. Refusal is a 429 carrying `retryAfterSec`, so the mobile countdown works unchanged. **Known and accepted:** the window is fixed, so 10 at 09:59 + 10 at 10:01 is 20 in two minutes; a sliding window would change login-throttle behaviour through the shared primitive — see A-008
- [x] **A-008** `low` Decide whether the shared rate limiter should slide instead of jump — **decided 2026-08-06: keep the fixed window, keep the budgets. Nothing was built; a trade-off was chosen.** The window starts on the first hit, not on a clock boundary, so a caller who spends the full budget at T and again at T+window gets 2x `max` back to back (Better Auth's credential routes 5/15min ⇒ a momentary 10; `addCaregiverPatient` 10/10min ⇒ a momentary 20). Accepted because the **sustained** rate is unchanged — only the momentary burst doubles — and both threats this limiter answers (credential stuffing, and the account enumeration A-007 mitigates) are priced in attempts per _hour_, not per second, so 2x for one instant barely moves an attacker's cost. Halving `max` was considered and **rejected, not overlooked**: three login attempts per fifteen minutes is not enough for a real user mistyping a password, so it degrades legitimate users to fix something that does not meaningfully help an attacker. A sliding window (sorted-set log, or two-bucket weighted counter) closes it precisely, but every consumer shares this one primitive — changing it changes Better Auth's credential routes too, and `consumeInMemory` would have to implement the same algorithm or a Redis outage would silently change semantics: large surface, small gain. **Revisit if:** a consumer needs a budget large enough that halving it is expensive; `retryAfter` needs to be second-accurate for UX; or a compliance rule names sliding windows. Full rationale lives as a doc comment above the `CONSUME` script in `server/app/api-gateway/src/redis/rate-limit.service.ts` — do not reopen this from first principles

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
