import type { PrismaClient } from '@prisma/client';
import type { Reminder, ReminderRepository } from './types.js';

export class PrismaReminderRepository implements ReminderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: Parameters<ReminderRepository['create']>[0]): Promise<Reminder> {
    return this.prisma.reminder.create({ data });
  }

  async list(userId: string): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({ where: { userId } });
  }

  async findByTitle(userId: string, query: string): Promise<Reminder | null> {
    return this.prisma.reminder.findFirst({
      where: {
        userId,
        title: { contains: query }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async findDue(now: Date): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: {
        status: 'scheduled',
        remindAt: { lte: now }
      }
    });
  }

  async update(id: string, data: Partial<Reminder>): Promise<Reminder> {
    return this.prisma.reminder.update({ where: { id }, data });
  }
}
