# Feature Module Structure

Reference convention for every feature module under `src/`. The
`storage/` and `ai/` modules are the canonical templates — copy their
shape when adding a new module.

## Layout

```text
src/<feature>/
├── dto/
│   ├── <name>.input.ts        # @InputType — GraphQL inputs + class-validator
│   └── <name>.object.ts       # @ObjectType — GraphQL outputs
├── types/
│   └── <feature>.types.ts     # internal TS types/enums/constants (not exposed via GraphQL)
├── <feature>.module.ts        # @Module — wiring only
├── <feature>.resolver.ts      # @Resolver — GraphQL surface, guards, no business logic
├── <feature>.service.ts       # @Injectable — business logic, Prisma access
├── <feature>.controller.ts    # @Controller — optional, REST endpoints only
└── <feature>.service.spec.ts  # unit tests
```

Sub-clients (e.g. `s3-storage.client.ts`) live next to the service when
they are transport wrappers around a third-party SDK.

## File responsibilities

| File | Owns |
| --- | --- |
| `dto/*.input.ts` | One `@InputType` class. class-validator decorators on every field. No business logic. |
| `dto/*.object.ts` | One `@ObjectType` class. Plain shape returned to GraphQL. Use explicit `@ObjectType('Name')` to pin schema name independent of class rename. |
| `types/*.types.ts` | Internal TS types, enums, constants. Never imported by clients. |
| `*.resolver.ts` | Thin. `@UseGuards(GqlAuthGuard)` at class level. Inject service, call one method, return. Log entry only. |
| `*.service.ts` | All business logic. Throw `HttpException` subclasses with Thai messages. Inject `PrismaService`. |
| `*.module.ts` | Providers + exports only. No factories inline beyond simple `useFactory` config providers. |

## Naming

- Class suffix matches the role: `*Input`, `*Object`, `*Service`, `*Resolver`, `*Controller`, `*Module`, `*Client`.
- File names are kebab-case mirroring the class: `upload-image.input.ts` → `UploadImageInput`.
- GraphQL schema names are pinned via `@ObjectType('SchemaName')` / `@InputType('SchemaName')` when class is renamed, so renames never break the wire contract.

## Rules

1. **No `eslint-disable` block at file top.** Fix the underlying type
   issue (use `type` imports, narrow `unknown` properly).
2. **No `any` on request/response objects.** Use Fastify's
   `FastifyReply` / `FastifyRequest` in controllers, typed DTOs in
   resolvers.
3. **No SDK calls from services.** Wrap third-party SDKs in a
   `*.client.ts` class first (see `S3StorageClient`); services compose
   on top.
4. **No env reads outside config providers.** Each external integration
   ships a `<name>.config.ts` factory provider with fail-fast on missing
   vars.
5. **DTOs do their own validation.** Every `@Field` on an `@InputType`
   has at least one class-validator decorator. The global
   `ValidationPipe` handles enforcement.
6. **Schema is generated, not hand-written.** Don't edit `src/schema.gql`.

## Migration order (existing modules → this template)

Done:

- `storage/` ✅
- `ai/` ✅ (already followed the pattern)
- `auth/` ✅ (with 20-test safety net in `auth.service.spec.ts`)

Pending PRs (one module per PR):

- `reading/`
- `post/`
- `comment/`
- `alert/`
- `caregiver/`

## Test conventions

- Service tests sit beside the service as `*.service.spec.ts` (matched by jest's `testRegex`).
- Mock `PrismaService` with `{ provide: PrismaService, useValue: prismaMock }` — never hit a real DB from unit tests.
- Stub third-party libs at the module level (`jest.mock('bcrypt')`, `jest.mock('jsonwebtoken')`).
- Cover the happy path + every `throw` branch in the service.
- For tests that exercise JWT signing, set `process.env.JWT_SECRET` to a ≥32-char string in `beforeAll`, restore in `afterAll`.
