import { CalendarService } from '../../../src/tools/calendar/CalendarService.js';
import { CalendarTool } from '../../../src/tools/calendar/CalendarTool.js';
import { LocalCalendarProvider } from '../../../src/tools/calendar/LocalCalendarProvider.js';

describe('CalendarTool', () => {
  it('asks for clarification when required event time is missing', async () => {
    const tool = new CalendarTool(new CalendarService(new LocalCalendarProvider()));

    const result = await tool.execute({
      action: 'create',
      title: 'Meeting with Ahmed'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('What time should I schedule it?');
  });

  it('creates, lists, moves, and cancels calendar events through the provider', async () => {
    const tool = new CalendarTool(new CalendarService(new LocalCalendarProvider()));
    const ctx = { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' };

    const created = await tool.execute({
      action: 'create',
      title: 'Meeting with Ahmed',
      startTime: '2026-08-30T12:00:00.000Z',
      endTime: '2026-08-30T13:00:00.000Z',
      participants: ['Ahmed']
    }, ctx);
    expect(created.ok).toBe(true);

    const listed = await tool.execute({
      action: 'list',
      startTime: '2026-08-30T00:00:00.000Z',
      endTime: '2026-08-31T00:00:00.000Z'
    }, ctx);
    expect(listed.message).toContain('Meeting with Ahmed');

    const moved = await tool.execute({
      action: 'move',
      query: 'Ahmed',
      startTime: '2026-08-30T14:00:00.000Z',
      endTime: '2026-08-30T15:00:00.000Z'
    }, ctx);
    expect(moved.message).toContain('moved');

    const cancelled = await tool.execute({ action: 'cancel', query: 'Ahmed' }, ctx);
    expect(cancelled.message).toContain('cancelled');
  });
});
