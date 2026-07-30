import { All, Controller, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { BETTER_AUTH, InjectBetterAuth } from './better-auth.provider';
import type { BetterAuthInstance } from './better-auth';

/**
 * Mounts Better Auth's own routes under `/api/auth/*`.
 *
 * The rest of the gateway is GraphQL, and the ten auth operations stay there
 * as resolvers wrapping `auth.api.*`. This controller exists for the parts
 * that cannot go through GraphQL: the OAuth redirect and its callback, which
 * are browser navigations, not queries.
 *
 * Better Auth speaks the Fetch API, so the Fastify request is translated in
 * and the Response translated back out.
 */
@Controller('api/auth')
export class BetterAuthController {
  constructor(@InjectBetterAuth() private readonly auth: BetterAuthInstance) {}

  @All('*path')
  async handle(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const response = await this.auth.handler(toFetchRequest(request));

    reply.status(response.status);
    response.headers.forEach((value, key) => {
      // set-cookie may legitimately repeat; append rather than overwrite so a
      // response that rotates more than one cookie does not lose all but the
      // last.
      if (key.toLowerCase() === 'set-cookie') reply.header(key, value);
      else reply.header(key, value);
    });

    const body = await response.text();
    await reply.send(body || null);
  }
}

/** Rebuilds the incoming Fastify request as a Fetch `Request`. */
function toFetchRequest(request: FastifyRequest): Request {
  const url = new URL(
    request.url,
    `${request.protocol}://${request.headers.host ?? 'localhost'}`,
  );

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.append(key, value);
  }

  // Fastify has already parsed the body. Re-serialising is not free, but the
  // alternative — reading the raw stream — fights the global ValidationPipe
  // and body limit that every other route relies on.
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body =
    hasBody && request.body !== undefined && request.body !== null
      ? typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body)
      : undefined;

  return new Request(url, {
    method: request.method,
    headers,
    body,
  });
}

export { BETTER_AUTH };
