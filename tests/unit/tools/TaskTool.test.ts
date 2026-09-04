import { TaskService } from '../../../src/tools/tasks/TaskService.js';
import { TaskTool } from '../../../src/tools/tasks/TaskTool.js';
import { InMemoryTaskRepository } from '../../utils/InMemoryTaskRepository.js';

describe('TaskTool', () => {
  it('creates, lists, completes, and reschedules tasks', async () => {
    const service = new TaskService(new InMemoryTaskRepository());
    const tool = new TaskTool(service);

    const created = await tool.execute({
      action: 'create',
      title: 'Finish backend',
      priority: 'high',
      dueDate: '2026-08-30T09:00:00.000Z'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(created.ok).toBe(true);
    expect(created.message).toContain('Finish backend');

    const listed = await tool.execute({ action: 'list', dateRange: 'all' }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });
    expect(listed.message).toContain('Finish backend');

    const completed = await tool.execute({ action: 'complete', query: 'backend' }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });
    expect(completed.message).toContain('completed');

    const moved = await tool.execute({
      action: 'reschedule',
      query: 'backend',
      dueDate: '2026-09-04T09:00:00.000Z'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });
    expect(moved.ok).toBe(false);
  });
});
