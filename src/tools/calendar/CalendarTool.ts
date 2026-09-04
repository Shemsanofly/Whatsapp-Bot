import { z } from 'zod';
import type { AgentTool, ToolExecutionContext, ToolResult } from '../AgentTool.js';
import { CalendarService } from './CalendarService.js';

const calendarInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    title: z.string().min(1),
    description: z.string().optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    timezone: z.string().optional(),
    location: z.string().optional(),
    participants: z.array(z.string()).optional()
  }),
  z.object({
    action: z.literal('list'),
    startTime: z.string().datetime(),
    endTime: z.string().datetime()
  }),
  z.object({
    action: z.literal('move'),
    query: z.string().min(1),
    startTime: z.string().datetime(),
    endTime: z.string().datetime()
  }),
  z.object({
    action: z.literal('cancel'),
    query: z.string().min(1)
  })
]);

export class CalendarTool implements AgentTool {
  name = 'CalendarTool';
  description = 'Create, list, move, and cancel calendar events. Ask for clarification when event date, time, or duration is missing.';
  inputSchema = {
    type: 'object',
    required: ['action'],
    properties: {
      action: { enum: ['create', 'list', 'move', 'cancel'] },
      title: { type: 'string' },
      startTime: { type: 'string', format: 'date-time' },
      endTime: { type: 'string', format: 'date-time' },
      query: { type: 'string' },
      participants: { type: 'array', items: { type: 'string' } },
      location: { type: 'string' }
    }
  };

  constructor(private readonly service: CalendarService) {}

  async execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const parsed = calendarInputSchema.parse(input);

    if (parsed.action === 'create') {
      if (!parsed.startTime) {
        return { ok: false, message: 'What time should I schedule it?' };
      }
      if (!parsed.endTime) {
        return { ok: false, message: 'How long should the meeting be?' };
      }
      const event = await this.service.create({
        userId: context.userId,
        title: parsed.title,
        description: parsed.description,
        startTime: new Date(parsed.startTime),
        endTime: new Date(parsed.endTime),
        timezone: parsed.timezone ?? context.timezone,
        location: parsed.location,
        participants: parsed.participants
      });
      return { ok: true, message: `Done. I scheduled "${event.title}".`, data: event };
    }

    if (parsed.action === 'list') {
      const events = await this.service.list(context.userId, new Date(parsed.startTime), new Date(parsed.endTime));
      if (events.length === 0) {
        return { ok: true, message: 'You do not have any matching calendar events.' };
      }
      return {
        ok: true,
        message: `Here is your calendar:\n${events.map((event) => `- ${event.title} at ${event.startTime.toISOString()}`).join('\n')}`,
        data: events
      };
    }

    if (parsed.action === 'move') {
      const event = await this.service.move(context.userId, parsed.query, new Date(parsed.startTime), new Date(parsed.endTime));
      if (!event) {
        return { ok: false, message: `I couldn't find a calendar event matching "${parsed.query}".` };
      }
      return { ok: true, message: `Done. I moved "${event.title}".`, data: event };
    }

    const event = await this.service.cancel(context.userId, parsed.query);
    if (!event) {
      return { ok: false, message: `I couldn't find a calendar event matching "${parsed.query}".` };
    }
    return { ok: true, message: `Done. I cancelled "${event.title}".`, data: event };
  }
}
