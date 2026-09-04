import { z } from 'zod';
import type { AgentTool, ToolExecutionContext, ToolResult } from '../AgentTool.js';
import { ReminderService } from './ReminderService.js';

const reminderInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    title: z.string().min(1),
    description: z.string().optional(),
    remindAt: z.string().datetime(),
    recurrenceRule: z.string().optional()
  }),
  z.object({
    action: z.literal('cancel'),
    query: z.string().min(1)
  })
]);

export class ReminderTool implements AgentTool {
  name = 'ReminderTool';
  description = 'Create and cancel one-time or recurring reminders.';
  inputSchema = {
    type: 'object',
    required: ['action'],
    properties: {
      action: { enum: ['create', 'cancel'] },
      title: { type: 'string' },
      description: { type: 'string' },
      remindAt: { type: 'string', format: 'date-time' },
      recurrenceRule: { type: 'string' },
      query: { type: 'string' }
    }
  };

  constructor(private readonly service: ReminderService) {}

  async execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const parsed = reminderInputSchema.parse(input);
    if (parsed.action === 'create') {
      const reminder = await this.service.create({
        userId: context.userId,
        title: parsed.title,
        description: parsed.description,
        remindAt: new Date(parsed.remindAt),
        timezone: context.timezone,
        recurrenceRule: parsed.recurrenceRule
      });
      return { ok: true, message: `Done. I'll remind you about "${reminder.title}".`, data: reminder };
    }

    const reminder = await this.service.cancel(context.userId, parsed.query);
    if (!reminder) {
      return { ok: false, message: `I couldn't find a scheduled reminder matching "${parsed.query}".` };
    }
    return { ok: true, message: `Done. I cancelled "${reminder.title}".`, data: reminder };
  }
}
