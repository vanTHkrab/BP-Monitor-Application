# BP Monitor — Task Board

_Last updated: 2026-08-06 · Updated by bp-task_

## Imports

<!-- bp-task resolves these at read time. Tasks from imported files are merged
     into the board with their scope prefix. Duplicates are skipped. -->
@docs/project/api-gateway-plan.md

---

## Tasks

### client

- [ ] **C-001** `high` Wire caregiver push-notification preference screen to the store
- [ ] **C-002** `medium` Add 7-day BP trend chart to the history tab
- [ ] **C-003** `medium` Implement PIN / biometric lock for the app-open flow
- [x] **C-004** `high` Integrate on-device YOLO pre-flight result into camera UI warning banner — closed 2026-08-06 as superseded, not implemented: the live framing gate replaced the warning-banner design and already shipped (`docs/project/CLIENT-remaining.md` §10)
- [ ] **C-005** `medium` Restore the caregiver "ดูข้อมูล" jump from invitations into a patient's readings — ship with the home/history tab port; `client/src/app/invitations.tsx` should set the viewing context in `client/src/modules/caregivers/`, not the auth store (see `docs/project/CLIENT-auth-structure.md`, "activePatientId")
- [ ] **C-006** `medium` Stop `formatErrorMessage` leaking English into user-facing errors — `client/src/services/api.ts:107` prepends `"<OperationName> failed: "`, and `stripCode` in `client/src/lib/error-message.ts:23` is anchored (`/^\s*\[[A-Z_]+\]\s*/`) so it never strips the code; affects all six call sites (post, invitations ×3, post/[id] ×2, readings, community) — preferred fix is dropping the operation-name prefix, since it is developer data
- [ ] **C-007** `medium` Add a severity filter to reading history (FR-03.2) — the requirement asks for period **or** severity; only period exists. `client/src/app/(tabs)/history.tsx:81` holds a single `timeFilter` and `filterByRange` is the only filter applied, and `history-list.tsx` carries no filter state at all, so a user wanting only high/critical readings must scroll and read the colour tints. `classifyReading` and the stored `status` column already exist, so the work is a filter predicate plus a pill row. Sub-point of the same task: the shipped buckets are `7days | 30days | 3months | 1year` (`client/src/modules/readings/lib/time-filter.ts:22-30`) against a requirement of daily / weekly / monthly — the substitutes are reasonable, but there is no daily bucket
- [ ] **C-008** `low` Delete the stale comment at `client/src/app/patient-health.tsx:39-41` — it claims `myPatients` returns neither `gender` nor `congenitalDisease` and that those two fields therefore start blank with a note explaining why. Commit `e15b1118` added both to `PatientSummaryType` and deleted that note; all five fields now pre-populate. The comment describes the tree at `710000fd` and is now simply false (root rule 6)

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
- [x] **A-006** `medium` Normalise `email` in `AuthService.updateProfile` — done 2026-08-06. `data.email` is now trimmed and lowercased **once, before the uniqueness check** (`server/app/api-gateway/src/auth/auth.service.ts:290`) and the normalised value is what gets patched (`:309`). Normalising at the top rather than only at the write fixes a second instance of the same bug that the original entry did not name: the pre-flight `findUnique({ where: { email } })` is exact-match on a `@unique` column, so a caller submitting `Foo@x.com` was checking a different key than the one being written — it could miss a real conflict and let the update fail at the database constraint instead of returning the intended `อีเมลนี้ถูกใช้งานแล้ว`. Still 0 bad rows, so no backfill was needed; this closes the only write path that could create one
- [x] **A-007** `high` Rate-limit `addCaregiverPatient` — done 2026-08-06: 10 attempts / 10 min, keyed on the **caregiver's user id** (keying on the contact string would let an attacker rotate addresses and never spend a budget) and counting every attempt, found or not. The honest `ไม่พบผู้ใช้จากอีเมลนี้` stays, as decided in A-005; this is its mitigation. The INCR + PEXPIRE Lua that used to live in `login-throttle.guard.ts` now lives in `server/app/api-gateway/src/redis/rate-limit.service.ts` — extracted out of `auth/better-auth.ts`, where Better Auth had inherited it, and covered by tests first. Refusal is a 429 carrying `retryAfterSec`, so the mobile countdown works unchanged. **Known and accepted:** the window is fixed, so 10 at 09:59 + 10 at 10:01 is 20 in two minutes; a sliding window would change login-throttle behaviour through the shared primitive — see A-008
- [x] **A-008** `low` Decide whether the shared rate limiter should slide instead of jump — **decided 2026-08-06: keep the fixed window, keep the budgets. Nothing was built; a trade-off was chosen.** The window starts on the first hit, not on a clock boundary, so a caller who spends the full budget at T and again at T+window gets 2x `max` back to back (Better Auth's credential routes 5/15min ⇒ a momentary 10; `addCaregiverPatient` 10/10min ⇒ a momentary 20). Accepted because the **sustained** rate is unchanged — only the momentary burst doubles — and both threats this limiter answers (credential stuffing, and the account enumeration A-007 mitigates) are priced in attempts per _hour_, not per second, so 2x for one instant barely moves an attacker's cost. Halving `max` was considered and **rejected, not overlooked**: three login attempts per fifteen minutes is not enough for a real user mistyping a password, so it degrades legitimate users to fix something that does not meaningfully help an attacker. A sliding window (sorted-set log, or two-bucket weighted counter) closes it precisely, but every consumer shares this one primitive — changing it changes Better Auth's credential routes too, and `consumeInMemory` would have to implement the same algorithm or a Redis outage would silently change semantics: large surface, small gain. **Revisit if:** a consumer needs a budget large enough that halving it is expensive; `retryAfter` needs to be second-accurate for UX; or a compliance rule names sliding windows. Full rationale lives as a doc comment above the `CONSUME` script in `server/app/api-gateway/src/redis/rate-limit.service.ts` — do not reopen this from first principles
- [x] **A-009** `high` Deliver push notifications for critical BP readings (FR-04.1) — **gateway half done 2026-08-07**; the client half is tracked separately as **C-001**. `PushToken` (`prisma/migrations/20260806164542_add_push_tokens`) is one row per app *installation*, keyed on a globally-`@unique` Expo token rather than on the user: the token belongs to the device, so a shared handset **reassigns** the row on the next `registerPushToken` instead of accumulating one per account — two rows would mean a patient's critical reading reaching whoever used the phone last. It deliberately does not hang off `user_sessions`, because a token must survive session rotation or a caregiver silently stops receiving alerts the moment their session refreshes; the price is that logout deletes it explicitly, which `logout(pushToken:)` / `logoutAllDevices(pushToken:)` now do (both arguments optional and additive — old call sites still compile). `ReadingService.createAlertForReading` sends via `PushService.notifyUsers` at `reading.service.ts:216`, fire-and-forget, reusing `getCaregiverAlertMessage` verbatim so there is one set of Thai copy rather than two. **Critical only, caregivers only** — both are decisions, not omissions: `Alert` rows are still written for `warning`, but a caregiver pushed for every warning-level reading of a chronic-hypertension patient mutes the channel and then misses the one that mattered; and the patient is holding the phone that just took the measurement. Dead tokens are pruned from both the send ticket and, 30 minutes later, the delivery receipt (`pending_receipt_id` + `@Cron` sweep) — receipt-stage `DeviceNotRegistered` is the common uninstall case, so ticket-only pruning would let the table grow forever. **Known and accepted:** the sweep's `@Cron` fires on every pod, which is safe here only because every step is idempotent (a receipt fetch is a read; the delete and the clear are already at their target state after the first run) — a *new* cron in this module has to make that argument or take a Redis lock. `EXPO_ACCESS_TOKEN` is optional and unset means Expo accepts a send from anyone holding one of our push tokens; set it in production. **Not exercisable in Expo Go** — Android dropped remote push in SDK 53, so the client half needs a dev build; the gateway treats "no token registered" as an ordinary outcome rather than an error precisely so that degrades honestly
- [ ] **A-010** `medium` **Decision, not implementation:** should a caregiver be able to edit their patient's name? (FR-01.3) — the requirement lists name, age, weight, height, congenital disease. `UpdatePatientHealthInput` (`schema.gql:609-615`) carries `dob`, `gender`, `weight`, `height`, `congenitalDisease`: age is covered by `dob`, name is not. There is no other route — `updateProfile` is the only mutation touching `firstname`/`lastname` and it is hard-scoped to `@CurrentUser()` with no `patientId` argument. This is **not an oversight**: `firstname`/`lastname` were deliberately excluded when the feature was built, on the reasoning that a name is how other people identify the patient rather than health data — the same judgement that excluded `email` and `phone`, which are unique Better Auth sign-in identities. So this entry is a product-owner call (follow the requirement, or keep the narrower scope and amend the requirement), **not a ticket to pick up and implement**. Do not add the fields until that call is made

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

---

## Functional-requirements audit — 2026-08-06 (`baa013da`)

Everything below was verified against code, not documentation. A `TASK.md`
entry is not an implementation and neither is a doc claim.

**Score: 12 Must-have requirements — 9 DONE, 3 PARTIAL, 0 MISSING.** The one
Should-have (gallery import) is DONE. The three PARTIALs are tracked as
**A-009** (`high`), **C-007** (`medium`), and **A-010** (`medium`, a decision
rather than a ticket).

### Findings, not work items

These came out of the same audit. None is a task; each is a fact about the
system that a future reader should not have to rediscover.

- **FR-01.1 has no "username".** Identity is phone or email. More narrowly,
  the _app_ only offers phone — `LoginInput` is `phone: String!` with no email
  variant, and no client surface reaches Better Auth's configured
  `/sign-in/email` route. "Sign in with email" is true of the server and false
  of the app.
- **FR-02.3 has two extraction engines** — online via `ai-service` over Redis,
  offline via the native Kotlin `bp-vision` module. The requirement assumes one.
- **FR-03.1's timestamp is the device clock, uncorrected.** A patient with a
  wrong phone clock files readings at the wrong time and the trend chart orders
  them wrongly. Literally compliant; "accurate" is doing quiet work in that
  sentence.
- **FR-03.4's classification is computed client-side and stored.** A reading
  fetched back renders whatever status was written to it, including by an older
  build with different thresholds.
