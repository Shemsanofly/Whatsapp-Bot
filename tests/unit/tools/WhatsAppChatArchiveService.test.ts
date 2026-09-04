import { WhatsAppChatArchiveService } from '../../../src/tools/chatArchive/WhatsAppChatArchiveService.js';
import type {
  ArchivedWhatsAppChat,
  ArchivedWhatsAppMessage,
  WhatsAppChatArchiveRepository
} from '../../../src/tools/chatArchive/types.js';

class FakeWhatsAppChatArchiveRepository implements WhatsAppChatArchiveRepository {
  async recordMessage(): Promise<void> {}

  public recordedContacts: Array<{ remoteJid: string; displayName?: string }> = [];

  async recordContact(input: { remoteJid: string; displayName?: string }): Promise<void> {
    this.recordedContacts.push(input);
  }

  async listRecentChats(): Promise<ArchivedWhatsAppChat[]> {
    return [];
  }

  async findMessages(): Promise<ArchivedWhatsAppMessage[]> {
    return [];
  }

  async findChats(query: string, limit: number): Promise<ArchivedWhatsAppChat[]> {
    return [
      {
        id: 'chat-1',
        remoteJid: '16033834344469@lid',
        displayName: query,
        isGroup: false,
        lastMessageAt: new Date('2026-08-29T21:56:39.000Z')
      }
    ].slice(0, limit);
  }
}

describe('WhatsAppChatArchiveService', () => {
  it('finds archived chats by contact name', async () => {
    const service = new WhatsAppChatArchiveService(new FakeWhatsAppChatArchiveRepository());

    const chats = await service.findChats('Amina Client');

    expect(chats).toEqual([
      {
        id: 'chat-1',
        remoteJid: '16033834344469@lid',
        displayName: 'Amina Client',
        isGroup: false,
        lastMessageAt: new Date('2026-08-29T21:56:39.000Z')
      }
    ]);
  });

  it('records contact names for later name-based lookup', async () => {
    const repository = new FakeWhatsAppChatArchiveRepository();
    const service = new WhatsAppChatArchiveService(repository);

    await (service as any).recordContact({
      remoteJid: '255700000000@s.whatsapp.net',
      displayName: 'Amina Home'
    });

    expect(repository.recordedContacts).toEqual([
      {
        remoteJid: '255700000000@s.whatsapp.net',
        displayName: 'Amina Home'
      }
    ]);
  });
});
