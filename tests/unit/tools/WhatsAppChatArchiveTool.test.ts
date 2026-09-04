import { WhatsAppChatArchiveTool } from '../../../src/tools/chatArchive/WhatsAppChatArchiveTool.js';
import { WhatsAppChatArchiveService } from '../../../src/tools/chatArchive/WhatsAppChatArchiveService.js';
import type { WhatsAppChatArchiveRepository } from '../../../src/tools/chatArchive/types.js';
import type { LLMProvider } from '../../../src/agent/types.js';

describe('WhatsAppChatArchiveTool', () => {
  it('lists recent archived WhatsApp chats', async () => {
    const tool = new WhatsAppChatArchiveTool(new WhatsAppChatArchiveService(repository()), llm());

    const result = await tool.execute({ action: 'list_chats' }, context());

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Project Group');
  });

  it('summarizes archived messages through the LLM', async () => {
    const summarized: string[] = [];
    const tool = new WhatsAppChatArchiveTool(
      new WhatsAppChatArchiveService(repository()),
      llm((text) => {
        summarized.push(text);
        return 'Alice mentioned a Friday deadline.';
      })
    );

    const result = await tool.execute({ action: 'action_items', query: 'deadline' }, context());

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Alice mentioned a Friday deadline.');
    expect(summarized[0]).toContain('deadline is Friday');
  });
});

function repository(): WhatsAppChatArchiveRepository {
  return {
    recordMessage: async () => undefined,
    recordContact: async () => undefined,
    listRecentChats: async () => [
      {
        id: 'chat-1',
        remoteJid: '1203630@g.us',
        displayName: 'Project Group',
        isGroup: true,
        lastMessageAt: new Date('2026-08-29T12:00:00.000Z')
      }
    ],
    findMessages: async () => [
      {
        id: 'message-1',
        externalId: 'wa-1',
        remoteJid: '1203630@g.us',
        participantJid: '255700000000@s.whatsapp.net',
        fromMe: false,
        text: 'deadline is Friday',
        messageAt: new Date('2026-08-29T12:00:00.000Z')
      }
    ],
    findChats: async () => []
  };
}

function llm(summarize: (text: string) => string = () => 'summary'): LLMProvider {
  return {
    decide: async () => ({ kind: 'final', content: 'unused' }),
    summarize: async (text) => summarize(text)
  };
}

function context() {
  return { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' };
}
