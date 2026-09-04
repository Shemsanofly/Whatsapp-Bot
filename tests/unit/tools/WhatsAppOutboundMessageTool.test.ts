import { WhatsAppOutboundMessageTool } from '../../../src/tools/whatsapp/WhatsAppOutboundMessageTool.js';
import type { WhatsAppSender } from '../../../src/whatsapp/types.js';
import type { ArchivedWhatsAppChat } from '../../../src/tools/chatArchive/types.js';

class FakeWhatsAppSender implements WhatsAppSender {
  sent: Array<{ to: string; text: string }> = [];

  async sendText(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }
}

class FakeContactResolver {
  constructor(private readonly chats: ArchivedWhatsAppChat[]) {}

  async findChats(query: string): Promise<ArchivedWhatsAppChat[]> {
    const normalizedQuery = query.toLowerCase();
    return this.chats.filter((chat) => chat.displayName?.toLowerCase().includes(normalizedQuery));
  }
}

describe('WhatsAppOutboundMessageTool', () => {
  it('sends a direct WhatsApp message to a normalized phone number', async () => {
    const sender = new FakeWhatsAppSender();
    const tool = new WhatsAppOutboundMessageTool(sender);

    const result = await tool.execute({
      action: 'send',
      recipient: '+255 712 345 678',
      message: 'Hello, I will call you later.'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Sent WhatsApp message to 255712345678.');
    expect(sender.sent).toEqual([
      { to: '255712345678@s.whatsapp.net', text: 'Hello, I will call you later.' }
    ]);
  });

  it('sends a direct WhatsApp message to a WhatsApp JID', async () => {
    const sender = new FakeWhatsAppSender();
    const tool = new WhatsAppOutboundMessageTool(sender);

    await tool.execute({
      action: 'send',
      recipient: '255712345678@s.whatsapp.net',
      message: 'Meeting moved to 3pm.'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(sender.sent).toEqual([
      { to: '255712345678@s.whatsapp.net', text: 'Meeting moved to 3pm.' }
    ]);
  });

  it('sends a direct WhatsApp message to a WhatsApp lid JID', async () => {
    const sender = new FakeWhatsAppSender();
    const tool = new WhatsAppOutboundMessageTool(sender);

    const result = await tool.execute({
      action: 'send',
      recipient: '16033834344469@lid',
      message: 'Good night.'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(result.ok).toBe(true);
    expect(sender.sent).toEqual([
      { to: '16033834344469@lid', text: 'Good night.' }
    ]);
  });

  it('resolves an archived contact name before sending', async () => {
    const sender = new FakeWhatsAppSender();
    const tool = new WhatsAppOutboundMessageTool(sender, new FakeContactResolver([
      {
        id: 'chat-1',
        remoteJid: '16033834344469@lid',
        displayName: 'Amina Client',
        isGroup: false,
        lastMessageAt: new Date('2026-08-29T21:56:39.000Z')
      }
    ]));

    const result = await tool.execute({
      action: 'send',
      recipient: 'Amina Client',
      message: 'Good night'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Sent WhatsApp message to Amina Client.');
    expect(sender.sent).toEqual([
      { to: '16033834344469@lid', text: 'Good night' }
    ]);
  });

  it('does not send when an archived contact name is ambiguous', async () => {
    const sender = new FakeWhatsAppSender();
    const tool = new WhatsAppOutboundMessageTool(sender, new FakeContactResolver([
      {
        id: 'chat-1',
        remoteJid: '16033834344469@lid',
        displayName: 'Amina Client',
        isGroup: false,
        lastMessageAt: new Date('2026-08-29T21:56:39.000Z')
      },
      {
        id: 'chat-2',
        remoteJid: '150744997077134@lid',
        displayName: 'Amina Home',
        isGroup: false,
        lastMessageAt: new Date('2026-08-29T21:56:15.000Z')
      }
    ]));

    const result = await tool.execute({
      action: 'send',
      recipient: 'Amina',
      message: 'Good night'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('I found multiple WhatsApp chats matching "Amina"');
    expect(result.message).toContain('Amina Client (16033834344469@lid)');
    expect(result.message).toContain('Amina Home (150744997077134@lid)');
    expect(sender.sent).toEqual([]);
  });

  it('does not send when an archived contact name is unknown', async () => {
    const sender = new FakeWhatsAppSender();
    const tool = new WhatsAppOutboundMessageTool(sender, new FakeContactResolver([]));

    const result = await tool.execute({
      action: 'send',
      recipient: 'Unknown Person',
      message: 'Good night'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('I could not find a WhatsApp contact named "Unknown Person". Send the phone number or exact WhatsApp chat name.');
    expect(sender.sent).toEqual([]);
  });

  it('blocks outbound messages to groups and broadcasts', async () => {
    const sender = new FakeWhatsAppSender();
    const tool = new WhatsAppOutboundMessageTool(sender);

    const groupResult = await tool.execute({
      action: 'send',
      recipient: '12345@g.us',
      message: 'Hello group'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });
    const broadcastResult = await tool.execute({
      action: 'send',
      recipient: 'status@broadcast',
      message: 'Hello broadcast'
    }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(groupResult.ok).toBe(false);
    expect(groupResult.message).toBe('I can only send outbound WhatsApp messages to direct contacts right now.');
    expect(broadcastResult.ok).toBe(false);
    expect(sender.sent).toEqual([]);
  });
});
