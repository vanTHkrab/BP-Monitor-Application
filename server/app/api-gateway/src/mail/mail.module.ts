import { Module } from '@nestjs/common';

import { MailService } from './mail.service';

/**
 * Imported by `AuthModule`, which is the only consumer: every email this
 * gateway sends today is a credential (a reset link, a verification link, a
 * one-time code) and is emitted from Better Auth's callbacks.
 *
 * Deliberately not `@Global()`. Mail is a side effect with a cost and a quota,
 * so a new sender should have to declare the dependency rather than find it
 * ambiently available.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
