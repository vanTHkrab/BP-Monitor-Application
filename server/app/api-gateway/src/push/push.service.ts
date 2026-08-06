import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  ExpoPushMessage,
  ExpoPushReceiptId,
  ExpoPushTicket,
} from 'expo-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { EXPO_PUSH_CLIENT, type ExpoPushClient } from './expo-push.client';
import { RegisterPushTokenInput } from './push.types';

/**
 * How long to wait after a send before asking Expo for the receipt.
 *
 * Expo's own guidance is ~15 minutes: the ticket only means "queued", and the
 * receipt is not written until FCM/APNs have answered. Asking earlier returns
 * nothing and burns a request.
 */
const RECEIPT_READY_AFTER_MS = 15 * 60 * 1000;

/**
 * Expo keeps receipts for roughly 24 hours. Past that the id will never
 * resolve, so the sweep stops asking and clears it — otherwise a token whose
 * receipt was missed once would be re-queried on every tick forever.
 */
const RECEIPT_ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

/** Cap per sweep so one tick cannot monopolise the DB or Expo's rate budget. */
const MAX_RECEIPTS_PER_SWEEP = 500;

export type PushMessageInput = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * Owns Expo push-token registration and delivery.
 *
 * Two things about this service are load-bearing and easy to "improve" into
 * bugs:
 *
 *  1. **Nothing here throws at the caller on a delivery failure.** `notifyUsers`
 *     resolves either way. The only caller is the alert fan-out in
 *     `ReadingService.createAlertForReading`, where the reading is already
 *     saved and the in-app alert row already written — a push that fails must
 *     not turn a successful save into a failed mutation.
 *  2. **Having no registered token is not an error.** Expo Go on Android
 *     dropped remote push in SDK 53, so a caregiver running the app in Expo Go
 *     will never have a token. That has to read as "no device to notify", not
 *     as a failure, or every critical reading logs an exception for a
 *     condition nobody can fix.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EXPO_PUSH_CLIENT) private readonly expo: ExpoPushClient,
  ) {}

  /**
   * Register (or re-register) one installation's push token.
   *
   * Idempotent by construction: the client calls this on every launch, so the
   * write is an upsert keyed on the token — the column the device, not the
   * account, determines. That is also what makes a shared handset correct:
   * signing in as somebody else reassigns the existing row instead of adding
   * a second one, so the previous owner stops receiving that device's pushes
   * the moment the new user registers. Two rows would mean a patient's
   * critical reading reaching whoever used the phone last.
   */
  async registerToken(
    userId: string,
    input: RegisterPushTokenInput,
  ): Promise<boolean> {
    if (!this.expo.isExpoPushToken(input.token)) {
      throw new BadRequestException('รูปแบบโทเคนการแจ้งเตือนไม่ถูกต้อง');
    }

    await this.prisma.pushToken.upsert({
      where: { token: input.token },
      create: {
        token: input.token,
        userId,
        deviceLabel: input.deviceLabel ?? null,
        platform: input.platform ?? null,
      },
      update: {
        userId,
        deviceLabel: input.deviceLabel ?? null,
        platform: input.platform ?? null,
        lastRegisteredAt: new Date(),
        // A reassigned or refreshed token carries no interest in the previous
        // owner's outstanding receipt; leaving it would attribute an old
        // delivery outcome to the new registration.
        pendingReceiptId: null,
        pendingReceiptAt: null,
      },
    });

    return true;
  }

  /**
   * Remove one installation's token. Called on logout.
   *
   * Scoped to the caller's own rows: `token` is unique globally, so an
   * unscoped delete would let any authenticated user silence any other user's
   * device by guessing a token string.
   */
  async unregisterToken(userId: string, token: string): Promise<boolean> {
    const result = await this.prisma.pushToken.deleteMany({
      where: { token, userId },
    });
    return result.count > 0;
  }

  /**
   * Remove every token belonging to `userId` except `keepToken`.
   *
   * The "sign out everywhere else" counterpart. A `PushToken` deliberately has
   * no session to cascade from, so the other installations would otherwise
   * keep receiving alerts after being signed out.
   */
  async unregisterOtherTokens(
    userId: string,
    keepToken?: string,
  ): Promise<number> {
    const result = await this.prisma.pushToken.deleteMany({
      where: {
        userId,
        ...(keepToken ? { NOT: { token: keepToken } } : {}),
      },
    });
    return result.count;
  }

  /**
   * Deliver one message to every registered device of every listed user.
   *
   * Never rejects. Never throws. See the class doc.
   */
  async notifyUsers(
    userIds: string[],
    message: PushMessageInput,
  ): Promise<void> {
    if (userIds.length === 0) return;

    try {
      const rows = await this.prisma.pushToken.findMany({
        where: { userId: { in: userIds } },
        select: { token: true },
      });

      if (rows.length === 0) {
        // Expected, not exceptional — see the class doc on Expo Go.
        this.logger.debug(
          `No registered push tokens for ${userIds.length} recipient(s); nothing to deliver`,
        );
        return;
      }

      const messages: ExpoPushMessage[] = rows.map((row) => ({
        to: row.token,
        sound: 'default',
        // A critical BP reading is the one thing this channel carries, so it
        // is always allowed to wake the device. Widening what gets sent here
        // without revisiting this is how a notification channel gets muted.
        priority: 'high',
        title: message.title,
        body: message.body,
        data: message.data,
      }));

      for (const chunk of this.expo.chunkPushNotifications(messages)) {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        await this.handleTickets(chunk, tickets);
      }
    } catch (error) {
      this.logger.warn(
        `Push delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Reconcile the per-message tickets Expo returns against the tokens we sent
   * to.
   *
   * A 200 from `sendPushNotificationsAsync` says the *request* was accepted,
   * not that any message was: each ticket carries its own status, and a
   * `DeviceNotRegistered` ticket is Expo telling us this token can never
   * receive again (app uninstalled, or the token rotated). Keeping it means
   * every future critical reading spends a slot on an address that cannot
   * answer, forever. Tickets line up index-for-index with the chunk, which is
   * the only thing tying a ticket back to its token.
   */
  private async handleTickets(
    chunk: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
  ): Promise<void> {
    const dead: string[] = [];
    const pending: { token: string; receiptId: ExpoPushReceiptId }[] = [];

    tickets.forEach((ticket, index) => {
      const to = chunk[index]?.to;
      const token = typeof to === 'string' ? to : to?.[0];
      if (!token) return;

      if (ticket.status === 'ok') {
        pending.push({ token, receiptId: ticket.id });
        return;
      }

      if (ticket.details?.error === 'DeviceNotRegistered') {
        dead.push(token);
        return;
      }

      this.logger.warn(
        `Push ticket error (${ticket.details?.error ?? 'unknown'}): ${ticket.message}`,
      );
    });

    if (dead.length > 0) {
      await this.prisma.pushToken.deleteMany({
        where: { token: { in: dead } },
      });
      this.logger.log(`Pruned ${dead.length} unregistered push token(s)`);
    }

    // Park the receipt id so `sweepPushReceipts` can ask for the *delivery*
    // outcome later; a ticket only means Expo queued the message.
    const now = new Date();
    await Promise.all(
      pending.map((entry) =>
        this.prisma.pushToken.updateMany({
          where: { token: entry.token },
          data: { pendingReceiptId: entry.receiptId, pendingReceiptAt: now },
        }),
      ),
    );
  }

  /**
   * Second half of the pruning story: fetch delivery receipts for pushes Expo
   * accepted earlier and drop the tokens FCM/APNs have since rejected.
   *
   * `DeviceNotRegistered` arrives here — not at ticket time — whenever the
   * uninstall is only discovered on the delivery attempt, which is the common
   * case. Without this pass the table only ever sheds the tokens Expo already
   * knew were dead before sending.
   *
   * **Multi-instance note.** `@Cron` fires on every pod. This sweep is
   * idempotent by construction: fetching a receipt twice is a read, and both
   * the delete and the clear are keyed on values that are already at their
   * target state after the first run. No lock is needed; a *new* cron task
   * here would have to make the same argument or take one.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweepPushReceipts(): Promise<void> {
    const now = Date.now();

    const rows = await this.prisma.pushToken.findMany({
      where: {
        pendingReceiptId: { not: null },
        pendingReceiptAt: { lt: new Date(now - RECEIPT_READY_AFTER_MS) },
      },
      select: { token: true, pendingReceiptId: true, pendingReceiptAt: true },
      orderBy: { pendingReceiptAt: 'asc' },
      take: MAX_RECEIPTS_PER_SWEEP,
    });

    if (rows.length === 0) return;

    const tokenByReceiptId = new Map<string, string>();
    const abandoned: string[] = [];

    for (const row of rows) {
      if (!row.pendingReceiptId) continue;
      const age = now - (row.pendingReceiptAt?.getTime() ?? now);
      if (age > RECEIPT_ABANDON_AFTER_MS) {
        abandoned.push(row.token);
        continue;
      }
      tokenByReceiptId.set(row.pendingReceiptId, row.token);
    }

    const dead: string[] = [];
    const resolved: string[] = [...abandoned];

    try {
      const receiptIds = [...tokenByReceiptId.keys()];
      for (const idChunk of this.expo.chunkPushNotificationReceiptIds(
        receiptIds,
      )) {
        const receipts =
          await this.expo.getPushNotificationReceiptsAsync(idChunk);

        for (const [receiptId, receipt] of Object.entries(receipts)) {
          const token = tokenByReceiptId.get(receiptId);
          if (!token) continue;

          if (receipt.status === 'error') {
            if (receipt.details?.error === 'DeviceNotRegistered') {
              dead.push(token);
              continue;
            }
            this.logger.warn(
              `Push receipt error (${receipt.details?.error ?? 'unknown'}): ${receipt.message}`,
            );
          }
          // Delivered, or failed for a reason that does not condemn the
          // token (rate limit, oversized payload). Either way the receipt is
          // answered and the row should stop being swept.
          resolved.push(token);
        }
      }
    } catch (error) {
      // A receipt fetch that fails leaves the rows pending; the next tick
      // retries them. Anything already collected is still applied below.
      this.logger.warn(
        `Push receipt fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (dead.length > 0) {
      await this.prisma.pushToken.deleteMany({
        where: { token: { in: dead } },
      });
      this.logger.log(
        `Pruned ${dead.length} push token(s) reported DeviceNotRegistered`,
      );
    }

    const toClear = resolved.filter((token) => !dead.includes(token));
    if (toClear.length > 0) {
      await this.prisma.pushToken.updateMany({
        where: { token: { in: toClear } },
        data: { pendingReceiptId: null, pendingReceiptAt: null },
      });
    }
  }
}
