import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { ReminderService } from '../../tools/reminders/ReminderService.js';
import type { WhatsAppSender } from '../../whatsapp/types.js';
import type { Reminder } from '../../tools/reminders/types.js';
import { logger } from '../../utils/logger.js';

export interface ReminderRecipientResolver {
  resolveWhatsAppJid(userId: string): Promise<string | null>;
}

export class ReminderScheduler {
  private task?: ScheduledTask;

  constructor(private readonly deps: {
    reminders: ReminderService;
    sender: WhatsAppSender;
    recipients: ReminderRecipientResolver;
  }) {}

  start(): void {
    this.task = cron.schedule('* * * * *', () => {
      this.tick(new Date()).catch((error) => logger.error({ error }, 'Reminder scheduler tick failed'));
    });
  }

  stop(): void {
    this.task?.stop();
  }

  async tick(now: Date): Promise<void> {
    const due = await this.deps.reminders.triggerDueReminders(now);
    for (const reminder of due) {
      await this.deliver(reminder);
    }
  }

  private async deliver(reminder: Reminder): Promise<void> {
    const jid = await this.deps.recipients.resolveWhatsAppJid(reminder.userId);
    if (!jid) {
      logger.warn({ userId: reminder.userId }, 'No WhatsApp recipient for reminder');
      return;
    }
    await this.deps.sender.sendText(jid, `Reminder: ${reminder.title}`);
  }
}
