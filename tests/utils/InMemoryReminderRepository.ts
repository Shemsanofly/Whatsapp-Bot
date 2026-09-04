import type { Reminder, ReminderRepository } from '../../src/tools/reminders/types.js';

export class InMemoryReminderRepository implements ReminderRepository {
  private reminders: Reminder[] = [];

  async create(data: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt' | 'completedAt' | 'cancelledAt' | 'lastTriggeredAt' | 'status'>): Promise<Reminder> {
    const now = new Date();
    const reminder: Reminder = {
      id: `reminder-${this.reminders.length + 1}`,
      status: 'scheduled',
      completedAt: null,
      cancelledAt: null,
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
      ...data
    };
    this.reminders.push(reminder);
    return reminder;
  }

  async list(userId: string): Promise<Reminder[]> {
    return this.reminders.filter((reminder) => reminder.userId === userId);
  }

  async findByTitle(userId: string, query: string): Promise<Reminder | null> {
    return this.reminders.find((reminder) => reminder.userId === userId && reminder.title.toLowerCase().includes(query.toLowerCase())) ?? null;
  }

  async findDue(now: Date): Promise<Reminder[]> {
    return this.reminders.filter((reminder) => reminder.status === 'scheduled' && reminder.remindAt <= now);
  }

  async update(id: string, data: Partial<Reminder>): Promise<Reminder> {
    const index = this.reminders.findIndex((reminder) => reminder.id === id);
    this.reminders[index] = { ...this.reminders[index], ...data, updatedAt: new Date() };
    return this.reminders[index];
  }
}
