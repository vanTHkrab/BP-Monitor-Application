/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { EXPO_PUSH_CLIENT } from './expo-push.client';
import { PushService } from './push.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

describe('PushService', () => {
  let service: PushService;
  let prisma: {
    pushToken: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let expo: {
    isExpoPushToken: jest.Mock;
    sendPushNotificationsAsync: jest.Mock;
    getPushNotificationReceiptsAsync: jest.Mock;
    chunkPushNotifications: jest.Mock;
    chunkPushNotificationReceiptIds: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      pushToken: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    expo = {
      // Mirrors `Expo.isExpoPushToken`. The real SDK is ESM-only and cannot
      // be loaded by this CJS Jest setup at all — see `expo-push.client.ts`.
      isExpoPushToken: jest.fn(
        (token: unknown) =>
          typeof token === 'string' &&
          /^Expo(nent)?PushToken\[.+\]$/.test(token),
      ),
      sendPushNotificationsAsync: jest.fn().mockResolvedValue([]),
      getPushNotificationReceiptsAsync: jest.fn().mockResolvedValue({}),
      // The real SDK chunks by size; one chunk is enough for these tests and
      // keeps ticket-to-token index alignment obvious.
      chunkPushNotifications: jest.fn((messages: unknown[]) => [messages]),
      chunkPushNotificationReceiptIds: jest.fn((ids: unknown[]) => [ids]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PrismaService, useValue: prisma },
        { provide: EXPO_PUSH_CLIENT, useValue: expo },
      ],
    }).compile();

    service = module.get<PushService>(PushService);
  });

  describe('registerToken', () => {
    it('upserts on the token, so a repeated launch does not duplicate a row', async () => {
      await service.registerToken(USER_ID, {
        token: TOKEN_A,
        deviceLabel: 'Pixel 8',
        platform: 'android',
      });

      const call = prisma.pushToken.upsert.mock.calls[0][0];
      // Keyed on the token, not on (userId, token): the token identifies the
      // installation, which is what must not be duplicated.
      expect(call.where).toEqual({ token: TOKEN_A });
      expect(call.create).toMatchObject({ token: TOKEN_A, userId: USER_ID });
    });

    it('reassigns a token that moved to another account on a shared device', async () => {
      await service.registerToken(OTHER_USER_ID, { token: TOKEN_A });

      // The update branch has to rewrite userId, or the previous owner keeps
      // receiving pushes for a phone that is now signed in as someone else.
      expect(prisma.pushToken.upsert.mock.calls[0][0].update).toMatchObject({
        userId: OTHER_USER_ID,
        pendingReceiptId: null,
      });
    });

    it('rejects a string Expo could never deliver to', async () => {
      await expect(
        service.registerToken(USER_ID, { token: 'not-a-push-token' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushToken.upsert).not.toHaveBeenCalled();
    });
  });

  describe('unregisterToken', () => {
    it('scopes the delete to the caller, so a guessed token cannot silence someone else', async () => {
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.unregisterToken(USER_ID, TOKEN_A)).resolves.toBe(
        true,
      );

      expect(prisma.pushToken.deleteMany.mock.calls[0][0].where).toEqual({
        token: TOKEN_A,
        userId: USER_ID,
      });
    });
  });

  describe('unregisterOtherTokens', () => {
    it('keeps the current installation and drops the rest', async () => {
      await service.unregisterOtherTokens(USER_ID, TOKEN_A);

      expect(prisma.pushToken.deleteMany.mock.calls[0][0].where).toEqual({
        userId: USER_ID,
        NOT: { token: TOKEN_A },
      });
    });
  });

  describe('notifyUsers', () => {
    it('sends to every token of every recipient', async () => {
      prisma.pushToken.findMany.mockResolvedValue([
        { token: TOKEN_A },
        { token: TOKEN_B },
      ]);
      expo.sendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 'receipt-a' },
        { status: 'ok', id: 'receipt-b' },
      ]);

      await service.notifyUsers([USER_ID, OTHER_USER_ID], {
        title: 'ค่าความดันวิกฤต',
        body: 'คุณสมชาย ใจดี มีค่าความดันสูงมาก',
      });

      expect(prisma.pushToken.findMany.mock.calls[0][0].where).toEqual({
        userId: { in: [USER_ID, OTHER_USER_ID] },
      });
      const sent = expo.sendPushNotificationsAsync.mock.calls[0][0] as {
        to: string;
        title: string;
      }[];
      expect(sent.map((message) => message.to)).toEqual([TOKEN_A, TOKEN_B]);
      expect(sent[0].title).toBe('ค่าความดันวิกฤต');
    });

    it('does nothing when there are no recipients', async () => {
      await service.notifyUsers([], { title: 't', body: 'b' });

      expect(prisma.pushToken.findMany).not.toHaveBeenCalled();
      expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('degrades quietly when the recipient has no registered device', async () => {
      // The Expo Go case: a caregiver who cannot obtain a token at all. This
      // is an expected state, not a failure.
      prisma.pushToken.findMany.mockResolvedValue([]);

      await expect(
        service.notifyUsers([USER_ID], { title: 't', body: 'b' }),
      ).resolves.toBeUndefined();

      expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('never rejects when the send throws', async () => {
      prisma.pushToken.findMany.mockResolvedValue([{ token: TOKEN_A }]);
      expo.sendPushNotificationsAsync.mockRejectedValue(new Error('expo down'));

      await expect(
        service.notifyUsers([USER_ID], { title: 't', body: 'b' }),
      ).resolves.toBeUndefined();
    });

    it('prunes a token whose ticket comes back DeviceNotRegistered', async () => {
      prisma.pushToken.findMany.mockResolvedValue([
        { token: TOKEN_A },
        { token: TOKEN_B },
      ]);
      expo.sendPushNotificationsAsync.mockResolvedValue([
        {
          status: 'error',
          message: 'not registered',
          details: { error: 'DeviceNotRegistered' },
        },
        { status: 'ok', id: 'receipt-b' },
      ]);

      await service.notifyUsers([USER_ID], { title: 't', body: 'b' });

      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: [TOKEN_A] } },
      });
      // The healthy one is parked for a receipt check, not deleted.
      expect(prisma.pushToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: TOKEN_B },
          data: expect.objectContaining({ pendingReceiptId: 'receipt-b' }),
        }),
      );
    });

    it('keeps a token whose ticket failed for a recoverable reason', async () => {
      prisma.pushToken.findMany.mockResolvedValue([{ token: TOKEN_A }]);
      expo.sendPushNotificationsAsync.mockResolvedValue([
        {
          status: 'error',
          message: 'too many',
          details: { error: 'MessageRateExceeded' },
        },
      ]);

      await service.notifyUsers([USER_ID], { title: 't', body: 'b' });

      expect(prisma.pushToken.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('sweepPushReceipts', () => {
    const parked = (
      token: string,
      receiptId: string,
      ageMs = 20 * 60 * 1000,
    ) => ({
      token,
      pendingReceiptId: receiptId,
      pendingReceiptAt: new Date(Date.now() - ageMs),
    });

    it('deletes a token whose receipt reports DeviceNotRegistered', async () => {
      prisma.pushToken.findMany.mockResolvedValue([parked(TOKEN_A, 'r-a')]);
      expo.getPushNotificationReceiptsAsync.mockResolvedValue({
        'r-a': {
          status: 'error',
          message: 'gone',
          details: { error: 'DeviceNotRegistered' },
        },
      });

      await service.sweepPushReceipts();

      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: [TOKEN_A] } },
      });
      // Deleted rows must not also be "cleared" — the row no longer exists.
      expect(prisma.pushToken.updateMany).not.toHaveBeenCalled();
    });

    it('clears the pending receipt on a successful delivery', async () => {
      prisma.pushToken.findMany.mockResolvedValue([parked(TOKEN_A, 'r-a')]);
      expo.getPushNotificationReceiptsAsync.mockResolvedValue({
        'r-a': { status: 'ok' },
      });

      await service.sweepPushReceipts();

      expect(prisma.pushToken.deleteMany).not.toHaveBeenCalled();
      expect(prisma.pushToken.updateMany).toHaveBeenCalledWith({
        where: { token: { in: [TOKEN_A] } },
        data: { pendingReceiptId: null, pendingReceiptAt: null },
      });
    });

    it('abandons a receipt older than Expo keeps them, without asking for it', async () => {
      prisma.pushToken.findMany.mockResolvedValue([
        parked(TOKEN_A, 'r-a', 30 * 60 * 60 * 1000),
      ]);

      await service.sweepPushReceipts();

      // Expo drops receipts after ~24h; re-querying one forever is how this
      // sweep would turn into a permanent no-op loop.
      expect(expo.getPushNotificationReceiptsAsync).toHaveBeenCalledWith([]);
      expect(prisma.pushToken.updateMany).toHaveBeenCalledWith({
        where: { token: { in: [TOKEN_A] } },
        data: { pendingReceiptId: null, pendingReceiptAt: null },
      });
    });

    it('leaves rows pending when the receipt fetch fails, so the next tick retries', async () => {
      prisma.pushToken.findMany.mockResolvedValue([parked(TOKEN_A, 'r-a')]);
      expo.getPushNotificationReceiptsAsync.mockRejectedValue(
        new Error('expo down'),
      );

      await expect(service.sweepPushReceipts()).resolves.toBeUndefined();

      expect(prisma.pushToken.deleteMany).not.toHaveBeenCalled();
      expect(prisma.pushToken.updateMany).not.toHaveBeenCalled();
    });

    it('does not query Expo when nothing is parked', async () => {
      prisma.pushToken.findMany.mockResolvedValue([]);

      await service.sweepPushReceipts();

      expect(expo.getPushNotificationReceiptsAsync).not.toHaveBeenCalled();
    });
  });
});
