import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module';

/**
 * Boots the real application graph.
 *
 * The adapter is explicit: `createNestApplication()` defaults to Express,
 * while this service runs on Fastify + Mercurius, which rejects an Express
 * adapter at `init()`. That mismatch is why this suite failed before the
 * assertion ever ran.
 *
 * Booting the whole graph is the point — it is the only check that the
 * Better Auth instance can actually be constructed, which unit tests cannot
 * see because they inject a stub in its place.
 */
describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    // Fastify needs its plugin tree resolved before it will accept requests;
    // Express has no equivalent step, so this is easy to omit and then see as
    // a flaky 404.
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers Better Auth's own health route", async () => {
    // /ok is Better Auth's built-in endpoint, so a 200 here proves more than
    // the app booting: the controller is mounted at the right base path, the
    // Fastify request survives translation into a Fetch Request, and the
    // Response survives translation back. None of that is reachable from a
    // unit test, which injects a stub in the instance's place.
    await request(app.getHttpServer() as never)
      .get('/api/auth/ok')
      .expect(200);
  });
});
