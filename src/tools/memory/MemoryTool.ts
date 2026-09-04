import { z } from 'zod';
import type { AgentTool, ToolExecutionContext, ToolResult } from '../AgentTool.js';
import { MemoryService } from './MemoryService.js';

const memoryInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('remember'),
    content: z.string().min(1)
  }),
  z.object({
    action: z.literal('query'),
    query: z.string().min(1)
  })
]);

export class MemoryTool implements AgentTool {
  name = 'MemoryTool';
  description = 'Store long-term memory only when the user explicitly asks to remember something, and retrieve saved memories.';
  inputSchema = {
    type: 'object',
    required: ['action'],
    properties: {
      action: { enum: ['remember', 'query'] },
      content: { type: 'string' },
      query: { type: 'string' }
    }
  };

  constructor(private readonly service: MemoryService) {}

  async execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const parsed = memoryInputSchema.parse(input);
    if (parsed.action === 'remember') {
      await this.service.remember(context.userId, parsed.content);
      return { ok: true, message: 'Got it. I will remember that.' };
    }

    const memories = await this.service.search(context.userId, parsed.query);
    if (memories.length === 0) {
      return { ok: true, message: "I don't have a saved memory about that yet." };
    }
    return { ok: true, message: memories.map((memory) => memory.content).join('\n'), data: memories };
  }
}
