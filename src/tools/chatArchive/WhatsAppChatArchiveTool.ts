import { z } from 'zod';
import type { LLMProvider } from '../../agent/types.js';
import type { AgentTool, ToolExecutionContext, ToolResult } from '../AgentTool.js';
import { WhatsAppChatArchiveService } from './WhatsAppChatArchiveService.js';
import type { ArchivedWhatsAppMessage } from './types.js';

const chatArchiveInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list_chats'),
    limit: z.number().int().min(1).max(25).optional()
  }),
  z.object({
    action: z.enum(['summarize', 'action_items']),
    query: z.string().optional(),
    since: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(200).optional()
  })
]);

export class WhatsAppChatArchiveTool implements AgentTool {
  name = 'WhatsAppChatArchiveTool';
  description = [
    'Read the archived WhatsApp inbox for the owner.',
    'Use this to list recent chats, summarize what people are talking about, or extract tasks, deadlines, meeting requests, and action items from WhatsApp chats.',
    'Never use this to send outbound WhatsApp messages.'
  ].join(' ');
  inputSchema = {
    type: 'object',
    required: ['action'],
    properties: {
      action: { enum: ['list_chats', 'summarize', 'action_items'] },
      query: { type: 'string', description: 'Optional chat name, phone/JID, group name, person, or topic to search for.' },
      since: { type: 'string', format: 'date-time' },
      limit: { type: 'number' }
    }
  };

  constructor(
    private readonly service: WhatsAppChatArchiveService,
    private readonly llm: LLMProvider
  ) {}

  async execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    void context;
    const parsed = chatArchiveInputSchema.parse(input);

    if (parsed.action === 'list_chats') {
      const chats = await this.service.listRecentChats(parsed.limit ?? 10);
      if (chats.length === 0) {
        return { ok: true, message: 'No WhatsApp chats have been archived yet.' };
      }
      return {
        ok: true,
        message: `Recent WhatsApp chats:\n${chats.map((chat) => {
          const name = chat.displayName || chat.remoteJid;
          const last = chat.lastMessageAt ? `, last message ${chat.lastMessageAt.toISOString()}` : '';
          return `- ${name} (${chat.remoteJid}${last})`;
        }).join('\n')}`,
        data: chats
      };
    }

    const messages = await this.service.findMessages({
      query: parsed.query,
      since: parsed.since ? new Date(parsed.since) : undefined,
      limit: parsed.limit
    });
    if (messages.length === 0) {
      return { ok: true, message: 'I do not have matching WhatsApp messages archived yet.' };
    }
    if (!this.llm.summarize) {
      return { ok: false, message: 'WhatsApp chat summarization is not available because the AI provider is not configured.' };
    }

    const transcript = formatTranscript(messages);
    const mode = parsed.action === 'action_items' ? 'key_points' : 'conversation';
    const summary = await this.llm.summarize(transcript, mode);
    return {
      ok: true,
      message: summary,
      data: { messages: messages.length }
    };
  }
}

function formatTranscript(messages: ArchivedWhatsAppMessage[]): string {
  return messages.map((message) => {
    const sender = message.fromMe ? 'me' : message.participantJid || message.remoteJid;
    return `[${message.messageAt.toISOString()}] ${message.remoteJid} / ${sender}: ${message.text}`;
  }).join('\n');
}
