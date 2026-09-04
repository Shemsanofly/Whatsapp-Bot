import { z } from 'zod';
import type { AgentTool, ToolExecutionContext, ToolResult } from '../AgentTool.js';
import { TaskService } from './TaskService.js';

const taskInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    dueDate: z.string().datetime().optional()
  }),
  z.object({
    action: z.literal('list'),
    dateRange: z.enum(['all', 'today', 'week']).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional()
  }),
  z.object({
    action: z.literal('complete'),
    query: z.string().min(1)
  }),
  z.object({
    action: z.literal('reschedule'),
    query: z.string().min(1),
    dueDate: z.string().datetime()
  })
]);

export class TaskTool implements AgentTool {
  name = 'TaskTool';
  description = 'Create, list, complete, and reschedule personal tasks.';
  inputSchema = {
    type: 'object',
    required: ['action'],
    properties: {
      action: { enum: ['create', 'list', 'complete', 'reschedule'] },
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { enum: ['low', 'medium', 'high'] },
      dueDate: { type: 'string', format: 'date-time' },
      query: { type: 'string' },
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' }
    }
  };

  constructor(private readonly service: TaskService) {}

  async execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const parsed = taskInputSchema.parse(input);

    if (parsed.action === 'create') {
      const task = await this.service.create({
        userId: context.userId,
        title: parsed.title,
        description: parsed.description,
        priority: parsed.priority,
        dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null
      });
      return { ok: true, message: `Done. I added "${task.title}" to your tasks.`, data: task };
    }

    if (parsed.action === 'list') {
      const tasks = await this.service.list(context.userId, {
        from: parsed.from ? new Date(parsed.from) : undefined,
        to: parsed.to ? new Date(parsed.to) : undefined
      });
      if (tasks.length === 0) {
        return { ok: true, message: 'You do not have any matching tasks.' };
      }
      const lines = tasks.map((task) => {
        const due = task.dueDate ? ` due ${task.dueDate.toISOString()}` : '';
        return `- ${task.title} (${task.status}, ${task.priority})${due}`;
      });
      return { ok: true, message: `Here are your tasks:\n${lines.join('\n')}`, data: tasks };
    }

    if (parsed.action === 'complete') {
      const task = await this.service.complete(context.userId, parsed.query);
      if (!task) {
        return { ok: false, message: `I couldn't find an open task matching "${parsed.query}".` };
      }
      return { ok: true, message: `Done. I marked "${task.title}" as completed.`, data: task };
    }

    const task = await this.service.reschedule(context.userId, parsed.query, new Date(parsed.dueDate));
    if (!task) {
      return { ok: false, message: `I couldn't find an open task matching "${parsed.query}" to reschedule.` };
    }
    return { ok: true, message: `Done. I moved "${task.title}" to ${task.dueDate?.toISOString()}.`, data: task };
  }
}
