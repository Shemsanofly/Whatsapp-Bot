import { ReminderService } from '../../../src/tools/reminders/ReminderService.js';
import { ReminderTool } from '../../../src/tools/reminders/ReminderTool.js';
import { InMemoryReminderRepository } from '../../utils/InMemoryReminderRepository.js';

describe('ReminderTool', () => {
  it('creates and cancels one-time reminders', async () => {
    const service = new ReminderService(new InMemoryReminderRepository());
    const tool = new ReminderTool(service);

    const created = await tool.execute({
      action: 'create',
      title: 'Call Ahmed',
      remindAt: '2026-08-30T05:00:00.000Z'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(created.message).toContain('Call Ahmed');

    const cancelled = await tool.execute({ action: 'cancel', query: 'Ahmed' }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });
    expect(cancelled.message).toContain('cancelled');
  });

  it('returns due reminders and advances recurring reminders', async () => {
    const repository = new InMemoryReminderRepository();
    const service = new ReminderService(repository);
    await service.create({
      userId: 'user-1',
      title: 'Review tasks',
      remindAt: new Date('2026-08-31T06:00:00.000Z'),
      timezone: 'Africa/Dar_es_Salaam',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO'
    });

    const due = await service.triggerDueReminders(new Date('2026-08-31T06:01:00.000Z'));

    expect(due).toHaveLength(1);
    expect(due[0].title).toBe('Review tasks');
    const reminders = await repository.list('user-1');
    expect(reminders[0].status).toBe('scheduled');
    expect(reminders[0].remindAt.toISOString()).toBe('2026-09-07T06:00:00.000Z');
  });
});
