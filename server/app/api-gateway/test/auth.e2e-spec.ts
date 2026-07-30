import 'dotenv/config';

import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Exercises the GraphQL auth surface against a running application.
 *
 * These are the checks unit tests structurally cannot make: the wrappers use a
 * stubbed Better Auth instance there, so nothing verifies that the real one is
 * configured correctly. Three defects had already shipped past a green unit
 * suite — an admin role that did not exist, an Express adapter under Fastify,
 * and a baseURL that 404'd every route while the app booted cleanly.
 *
 * Runs against DATABASE_URL and creates real rows, so every user it makes is
 * removed afterwards.
 */
const describeWithDatabase = process.env.DATABASE_URL
  ? describe
  : describe.skip;

/** Phones and emails are unique; a per-run suffix keeps parallel runs apart. */
const RUN_ID = Date.now().toString().slice(-9);
const phoneFor = (n: number) => `${RUN_ID}${n}`.slice(0, 15);
const emailFor = (n: number) => `e2e-auth-${RUN_ID}-${n}@bp-monitor.invalid`;

const PASSWORD = 'e2e-Password-2026';

type GraphqlResponse<T> = {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
};

describeWithDatabase('auth (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];

  /** Posts a GraphQL operation, optionally authenticated. */
  async function gql<T>(
    query: string,
    variables?: Record<string, unknown>,
    token?: string,
  ): Promise<GraphqlResponse<T>> {
    const req = request(app.getHttpServer() as never)
      .post('/graphql')
      .set('content-type', 'application/json');

    if (token) req.set('authorization', `Bearer ${token}`);

    const response = await req.send({ query, variables });
    return response.body as GraphqlResponse<T>;
  }

  const REGISTER = `
    mutation Register($input: RegisterInput!) {
      register(input: $input) { token user { id email role firstname lastname } }
    }
  `;
  const LOGIN = `
    mutation Login($input: LoginInput!) {
      login(input: $input) { token user { id role } }
    }
  `;
  const ME = `query Me { me { id email role } }`;
  const LOGOUT = `mutation Logout { logout }`;

  async function registerUser(
    n: number,
    extra: Record<string, unknown> = {},
  ): Promise<
    GraphqlResponse<{
      register: { token: string; user: { id: string; role: string } };
    }>
  > {
    const email = emailFor(n);
    createdEmails.push(email);

    return gql(REGISTER, {
      input: {
        firstname: 'E2E',
        lastname: `User${n}`,
        phone: phoneFor(n),
        email,
        password: PASSWORD,
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // Mirrors main.ts. Without it the DTO validation under test does not run.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
  }, 30_000);

  afterAll(async () => {
    if (prisma && createdEmails.length) {
      // Cascades to sessions and accounts.
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app?.close();
  });

  describe('register', () => {
    it('creates an account and returns a usable session token', async () => {
      const result = await registerUser(1);

      expect(result.errors).toBeUndefined();
      expect(result.data?.register.token).toEqual(expect.any(String));
      expect(result.data?.register.user.id).toEqual(expect.any(String));
    });

    it('always creates a patient, and rejects a role from the caller', async () => {
      // Three guards stop a client naming its own role: the field is gone
      // from RegisterInput, `input: false` blocks it at the Better Auth
      // layer, and a before-create hook forces the default. This is the only
      // test that proves the combination holds.
      const supplied = await registerUser(2, { role: 'developer' });
      expect(supplied.errors).toBeDefined();

      const normal = await registerUser(21);
      expect(normal.errors).toBeUndefined();
      expect(normal.data?.register.user.role).toBe('patient');
    });

    it('rejects a duplicate phone', async () => {
      const first = await registerUser(3);
      expect(first.errors).toBeUndefined();

      const duplicate = await gql(REGISTER, {
        input: {
          firstname: 'E2E',
          lastname: 'Duplicate',
          phone: phoneFor(3),
          email: emailFor(31),
          password: PASSWORD,
        },
      });

      expect(duplicate.errors?.[0].extensions?.code).toBe('CONFLICT');
    });

    it('rejects a missing email', async () => {
      // Email became required with the Better Auth migration; it is the
      // ownership proof account linking depends on.
      const result = await gql(REGISTER, {
        input: {
          firstname: 'E2E',
          lastname: 'NoEmail',
          phone: phoneFor(4),
          password: PASSWORD,
        },
      });

      expect(result.errors).toBeDefined();
    });
  });

  describe('login', () => {
    it('returns a session token for valid credentials', async () => {
      await registerUser(5);

      const result = await gql<{ login: { token: string } }>(LOGIN, {
        input: { phone: phoneFor(5), password: PASSWORD },
      });

      expect(result.errors).toBeUndefined();
      expect(result.data?.login.token).toEqual(expect.any(String));
    });

    it('gives the same error for a wrong password and an unknown phone', async () => {
      await registerUser(6);

      const wrongPassword = await gql(LOGIN, {
        input: { phone: phoneFor(6), password: 'not-the-password' },
      });
      const unknownPhone = await gql(LOGIN, {
        input: { phone: phoneFor(99), password: PASSWORD },
      });

      // Distinguishing the two turns login into a phone-number oracle.
      expect(wrongPassword.errors?.[0].message).toBe(
        unknownPhone.errors?.[0].message,
      );
      expect(wrongPassword.errors?.[0].extensions?.code).toBe(
        unknownPhone.errors?.[0].extensions?.code,
      );
    });
  });

  describe('authenticated requests', () => {
    it('resolves the current user from the session token', async () => {
      const registered = await registerUser(7);
      const token = registered.data!.register.token;

      const result = await gql<{ me: { id: string; role: string } }>(
        ME,
        undefined,
        token,
      );

      expect(result.errors).toBeUndefined();
      expect(result.data?.me.id).toBe(registered.data!.register.user.id);
      expect(result.data?.me.role).toBe('patient');
    });

    it('reports UNAUTHENTICATED without a token', async () => {
      // The mobile client keys its global logout on exactly this code.
      const result = await gql(ME);

      expect(result.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
    });

    it('reports UNAUTHENTICATED for a token that is not a session', async () => {
      const result = await gql(ME, undefined, 'not-a-real-session-token');

      expect(result.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('logout', () => {
    it('revokes the session without deleting its history', async () => {
      const registered = await registerUser(8);
      const token = registered.data!.register.token;

      const loggedOut = await gql<{ logout: boolean }>(
        LOGOUT,
        undefined,
        token,
      );
      expect(loggedOut.errors).toBeUndefined();

      const afterLogout = await gql(ME, undefined, token);
      expect(afterLogout.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');

      // preserveSessionInDatabase keeps the row so the login-sessions screen
      // can show revoked devices; deleting it would empty that screen.
      const sessions = await prisma.userSession.findMany({
        where: { userId: registered.data!.register.user.id },
      });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((s) => s.isActive === false)).toBe(true);
    });
  });
});
