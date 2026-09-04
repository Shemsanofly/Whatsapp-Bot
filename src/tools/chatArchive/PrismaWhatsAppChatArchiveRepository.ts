import type { PrismaClient } from '@prisma/client';
import type {
  ArchivedWhatsAppChat,
  ArchivedWhatsAppMessage,
  RecordWhatsAppContactInput,
  RecordWhatsAppMessageInput,
  WhatsAppChatArchiveRepository
} from './types.js';

export class PrismaWhatsAppChatArchiveRepository implements WhatsAppChatArchiveRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordMessage(input: RecordWhatsAppMessageInput): Promise<void> {
    const chat = await this.prisma.whatsAppChat.upsert({
      where: { remoteJid: input.remoteJid },
      update: {
        displayName: input.displayName,
        isGroup: input.remoteJid.endsWith('@g.us'),
        lastMessageAt: input.messageAt
      },
      create: {
        remoteJid: input.remoteJid,
        displayName: input.displayName,
        isGroup: input.remoteJid.endsWith('@g.us'),
        lastMessageAt: input.messageAt
      }
    });

    const data = {
      externalId: input.externalId,
      chatId: chat.id,
      remoteJid: input.remoteJid,
      participantJid: input.participantJid,
      fromMe: input.fromMe,
      text: input.text,
      messageAt: input.messageAt
    };

    if (input.externalId) {
      await this.prisma.whatsAppChatMessage.upsert({
        where: { externalId: input.externalId },
        update: data,
        create: data
      });
      return;
    }

    await this.prisma.whatsAppChatMessage.create({ data });
  }

  async recordContact(input: RecordWhatsAppContactInput): Promise<void> {
    await this.prisma.whatsAppChat.upsert({
      where: { remoteJid: input.remoteJid },
      update: {
        displayName: input.displayName,
        isGroup: input.remoteJid.endsWith('@g.us')
      },
      create: {
        remoteJid: input.remoteJid,
        displayName: input.displayName,
        isGroup: input.remoteJid.endsWith('@g.us')
      }
    });
  }

  async listRecentChats(limit: number): Promise<ArchivedWhatsAppChat[]> {
    return this.prisma.whatsAppChat.findMany({
      orderBy: { lastMessageAt: 'desc' },
      take: limit
    });
  }

  async findChats(query: string, limit: number): Promise<ArchivedWhatsAppChat[]> {
    const terms = query.split(/\s+/).filter((term) => term.length > 1);
    return this.prisma.whatsAppChat.findMany({
      where: terms.length > 0
        ? {
          AND: terms.map((term) => ({
            OR: [
              { displayName: { contains: term } },
              { remoteJid: { contains: term } }
            ]
          }))
        }
        : undefined,
      orderBy: { lastMessageAt: 'desc' },
      take: limit
    });
  }

  async findMessages(input: { query?: string; since?: Date; limit: number }): Promise<ArchivedWhatsAppMessage[]> {
    const terms = input.query?.split(/\s+/).filter((term) => term.length > 1) ?? [];
    const where = {
      ...(input.since ? { messageAt: { gte: input.since } } : {}),
      ...(terms.length > 0
        ? {
          OR: terms.flatMap((term) => [
            { text: { contains: term } },
            { remoteJid: { contains: term } },
            { chat: { displayName: { contains: term } } }
          ])
        }
        : {})
    };

    const messages = await this.prisma.whatsAppChatMessage.findMany({
      where,
      orderBy: { messageAt: 'desc' },
      take: input.limit
    });

    return messages.reverse();
  }
}
