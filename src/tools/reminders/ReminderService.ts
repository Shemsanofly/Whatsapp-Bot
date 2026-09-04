import { DateTime } from 'luxon';
import type { Reminder, ReminderRepository } from './types.js';

export class ReminderService {
  constructor(private readonly repository: ReminderRepository) {}

  async create(input: {
    userId: string;
    title: string;
    description?: string | null;
    remindAt: Date;
    timezone: string;
    recurrenceRule?: string | null;
  }): Promise<Reminder> {
    return this.repository.create({
      userId: input.userId,
      title: input.title,
      description: input.description ?? null,
      remindAt: input.remindAt,
      timezone: input.timezone,
      recurrenceRule: input.recurrenceRule ?? null
    });
  }

  async cancel(userId: string, query: string): Promise<Reminder | null> {
    const reminder = await this.repository.findByTitle(userId, query);
    if (!reminder || reminder.status !== 'scheduled') {
      return null;
    }
    return this.repository.update(reminder.id, { status: 'cancelled', cancelledAt: new Date() });
  }

  async triggerDueReminders(now: Date): Promise<Reminder[]> {
    const due = await this.repository.findDue(now);
    for (const reminder of due) {
      if (reminder.recurrenceRule) {
        await this.repository.update(reminder.id, {
          remindAt: nextWeeklyOccurrence(reminder.remindAt, reminder.recurrenceRule, reminder.timezone),
          lastTriggeredAt: now
        });
      } else {
        await this.repository.update(reminder.id, {
          status: 'completed',
          completedAt: now,
          lastTriggeredAt: now
        });
      }
    }
    return due;
  }
}

function nextWeeklyOccurrence(current: Date, rule: string, timezone: string): Date {
  if (!rule.includes('FREQ=WEEKLY')) {
    return DateTime.fromJSDate(current, { zone: timezone }).plus({ weeks: 1 }).toUTC().toJSDate();
  }
  return DateTime.fromJSDate(current, { zone: timezone }).plus({ weeks: 1 }).toUTC().toJSDate();
}
