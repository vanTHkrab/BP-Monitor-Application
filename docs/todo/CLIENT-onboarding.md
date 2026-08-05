# Client: the onboarding flow

How a new account gets from "registered" to "using the app", and the rules a
new feature has to respect if it wants to add a step.

Read [CLIENT-auth-structure.md](./CLIENT-auth-structure.md) first for the
module layout this builds on.

## The flow

```text
สมัคร / Google sign-in
   ↓
/onboarding/role     เลือกบทบาท        → server state
   ↓
/onboarding/setup    ตั้งค่าแอปครั้งแรก  → device-local state
   ↓
/(tabs)
```

Registration does **not** ask for a role. `RegisterInput` has no `role`
field, and sending one is a validation error. Every account is created as
`patient` with `roleSelectedAt` null.

That is not a UI preference — it is the only arrangement that works for both
sign-up paths. A Google sign-up never sees `RegisterInput`, so a field on the
registration form would have left every OAuth user permanently a patient.
Putting the choice after sign-up gives both paths the same step.

## The rule that makes it resumable

Onboarding steps are **ordered and individually gated**, so someone who
force-quits halfway resumes where they stopped rather than starting over or
skipping ahead. The rule is pure and lives in
[`modules/auth/route-gate.ts`](../../client/src/modules/auth/route-gate.ts):

```ts
resolveGate({ status, roleSelected, appConfigured, preferencesHydrated })

  status === 'unknown'            -> wait
  status === 'unauthenticated'    -> /login
  roleSelected === null           -> wait          // `me` still in flight
  !preferencesHydrated            -> wait          // AsyncStorage still reading
  !roleSelected                   -> /onboarding/role
  !appConfigured                  -> /onboarding/setup
  otherwise                       -> /(tabs)
```

`route-gate.test.ts` is the specification. Add a case there before adding a
step.

### Two signals, because there are two kinds of state

| Step | State lives | Gate reads | Survives reinstall |
| --- | --- | --- | --- |
| เลือกบทบาท | server — `User.roleSelectedAt` | the `me` query | **yes** — do not re-ask |
| ตั้งค่าแอป | device — AsyncStorage | `usePreferencesStore` | no — re-asking is correct |

Collapsing these into one flag gets one of them wrong. After a reinstall the
user's role is still on the server and asking again would be asking a
question already answered; their font size genuinely is gone and asking again
is the right behaviour.

### Why `roleSelectedAt` and not `role`

`role` defaults to `patient`, so the column alone cannot distinguish "chose
patient" from "never chose". Gating on `role !== 'patient'` would ask every
patient the question on every launch, forever.

`roleSelectedAt` is stamped on **every** `selectRole` call, including a
choice equal to the default — choosing `patient` is still choosing.

### Why three states, not a boolean

`roleSelected` is `boolean | null`. `null` means "not known yet" — the `me`
query is in flight. Treating that as `false` flashes the role screen at a
user who chose months ago. The same reasoning as `AuthStatus.unknown`.

## Where the code is

```text
src/modules/onboarding/
├── index.ts                      public surface — services/ stays internal
├── types.ts                      SelectableRole ('patient' | 'caregiver')
├── services/
│   ├── operations.ts             GQL_SELECT_ROLE
│   └── onboarding-api.ts         the call + mapping
├── hooks/
│   ├── use-select-role.ts        mutation + `me` cache write
│   └── use-onboarding-state.ts   the two gate signals, from their real homes
└── components/
    ├── choice-card.tsx           large tappable card with a description
    └── onboarding-shell.tsx      step dots, heading, pinned action

src/app/onboarding/               NOT a (group) — the section is in the URL
├── _layout.tsx                   headerShown: false, gestureEnabled: false
├── role.tsx
└── setup.tsx

src/stores/preferences.store.ts   fontSize + setupCompleted + hydrated
```

`useSelectRole` writes the returned user straight into the `['me']` query
cache. Without that the screen navigates on, the gate re-reads a stale cache,
and bounces the user back into the step they just finished. **Any new step
that changes server state the gate reads must do the same.**

`src/app/onboarding/` is deliberately not `(onboarding)`. Parenthesised
directories are route *groups* and are stripped from the URL — as a group
these would have been `/role` and `/setup`, which read as unrelated
top-level screens.

## Adding a step

1. Decide which kind of state its completion is. Server → a column plus a
   field on `UserType`. Device-local → a key in `preferences.store.ts`.
2. Add the signal to `GateInput` and a case to `resolveGate`, **in order**.
3. Add cases to `route-gate.test.ts` — including the "still loading" one.
4. If it writes server state the gate reads, update the `['me']` cache in the
   hook's `onSuccess`.
5. Add the route under `src/app/onboarding/`.

## Known gaps

- **Phone collection after OAuth is not built.** `phone` is `NOT NULL` and a
  Google sign-up carries none, so that flow needs a step before `role`. It is
  blocked on Google credentials — see
  [CLIENT-auth-integration.md](./CLIENT-auth-integration.md).
- ~~**Font size is persisted but not consumed app-wide.**~~ Done. The three
  named holdouts — `auth-shell.tsx`, `gradient-button.tsx`, `option-row.tsx` —
  all scale now, and `ThemedText` scales by construction so a screen adopting
  it cannot forget. Mind the elderly-first readability floor (~11px body)
  documented in `client-old/CLAUDE.md`; `use-font-scale.ts` ties the scale
  back to it.

  **`useFontScale()` gained OS compensation in the same pass**, and that is
  the part worth knowing about. `<Text allowFontScaling>` defaults to `true`,
  so React Native multiplies the system accessibility font size on top of
  whatever the app computes — the two compounded to ~1.79× at OS 130% with
  the app at `xlarge`, and the preview on this flow's own setup screen, which
  shows the choice as a px number, was therefore wrong on any device whose
  system font size was not the default. The hook now divides the OS scale out
  and lets RN multiply it back, so the net size is exactly
  `base × preference` and the preview tells the truth. All 54 existing callers
  inherited the fix without an edit.

  The system setting is not ignored — it is expressed through the app's four
  steps, which is the control this app puts in front of the user. Anything
  that genuinely wants both stacked has to opt out with
  `allowFontScaling={false}` and multiply the OS scale itself; nothing does.

- **There is still no shared typography scale**, and `ThemedText`'s variants
  are not one. They are the sizes the app already used, given names. Three
  sizes in `auth-shell.tsx` (28 / 15 / 12) and the three button-label sizes in
  `gradient-button.tsx` map to no role and stay literal on purpose — minting
  single-use variants would put one screen's composition into a shared scale.
  When enough of those accumulate, that is the signal to design a real scale
  rather than to keep adding steps.
- **No "change role later" screen.** `selectRole` is deliberately
  re-callable, so a settings row can reuse the same hook. Safe because `role`
  is a UI mode, not an access-control boundary — reading another user's data
  requires an *accepted* caregiver link the patient approves.

## Gateway contract

`selectRole(input: { role })` — authenticated, returns `UserType`.
`role` is `UserRoleInput` (`patient | caregiver`); `developer` is not a
member and cannot be self-assigned from any surface. Full reference in
[docs/01-api/API.md](../01-api/API.md) and the rationale in
[AUTH-better-auth-identity.md](../../server/app/api-gateway/docs/AUTH-better-auth-identity.md).

Shipped in PR #87 against `client/optimize`.
