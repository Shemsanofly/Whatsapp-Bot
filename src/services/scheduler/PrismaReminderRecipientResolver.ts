import type { PrismaClient } from '@prisma/client';
import type { ReminderRecipientResolver } from './ReminderScheduler.js';

export class PrismaReminderRecipientResolver implements ReminderRecipientResolver {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveWhatsAppJid(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user ? `${user.whatsappNumber}@s.whatsapp.net` : null;
  }
}
