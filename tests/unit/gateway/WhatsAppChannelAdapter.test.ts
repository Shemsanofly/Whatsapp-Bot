import { WhatsAppChannelAdapter } from '../../../src/gateway/WhatsAppChannelAdapter.js';
import { WhatsAppAuthorizer } from '../../../src/security/WhatsAppAuthorizer.js';
import type { ChannelMessage } from '../../../src/gateway/types.js';
import type { IncomingWhatsAppMessage, WhatsAppHealth } from '../../../src/whatsapp/types.js';

class FakeWhatsAppConnection {
  public handler?: (message: IncomingWhatsAppMessage) => Promise<void>;
  public contactHandler?: (contact: { remoteJid: string; displayName?: string }) => Promise<void>;
  public starts = 0;
  public stops = 0;
  public sent: Array<{ to: string; text: string }> = [];
  public health: WhatsAppHealth = { connected: true, authenticated: true };

  onMessage(handler: (message: IncomingWhatsAppMessage) => Promise<void>): void {
    this.handler = handler;
  }

  onContact(handler: (contact: { remoteJid: string; displayName?: string }) => Promise<void>): void {
    this.contactHandler = handler;
  }

  async connect(): Promise<void> {
    this.starts += 1;
  }

  async shutdown(): Promise<void> {
    this.stops += 1;
  }

  async sendText(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }

  getHealth(): WhatsAppHealth {
    return this.health;
  }
}

describe('WhatsAppChannelAdapter', () => {
  it('delegates lifecycle, sending, and health to the WhatsApp connection', async () => {
    const connection = new FakeWhatsAppConnection();
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678'])
    });

    await adapter.start();
    await adapter.sendText('255712345678@s.whatsapp.net', 'hello');
    await adapter.stop();

    expect(adapter.id).toBe('whatsapp');
    expect(adapter.name).toBe('WhatsApp');
    expect(adapter.enabled).toBe(true);
    expect(connection.starts).toBe(1);
    expect(connection.stops).toBe(1);
    expect(connection.sent).toEqual([{ to: '255712345678@s.whatsapp.net', text: 'hello' }]);
    expect(adapter.getHealth()).toEqual({ connected: true, authenticated: true });
  });

  it('emits authorized WhatsApp messages as generic channel messages', async () => {
    const connection = new FakeWhatsAppConnection();
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678'])
    });
    const emitted: ChannelMessage[] = [];
    adapter.onMessage(async (message) => {
      emitted.push(message);
    });

    await connection.handler?.({
      id: 'message-1',
      from: '255712345678@s.whatsapp.net',
      fromMe: false,
      pushName: 'Owner',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'show my tasks'
    });

    expect(emitted).toEqual([
      {
        channel: 'whatsapp',
        messageId: 'message-1',
        conversationId: '255712345678@s.whatsapp.net',
        senderId: '255712345678',
        senderDisplayName: 'Owner',
        accessLevel: 'owner',
        fromSelf: false,
        text: 'show my tasks',
        timestamp: new Date('2026-08-29T12:00:00.000Z'),
        raw: expect.any(Object)
      }
    ]);
  });

  it('uses phone-number metadata for WhatsApp lid control messages', async () => {
    const connection = new FakeWhatsAppConnection();
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678'])
    });
    const emitted: ChannelMessage[] = [];
    adapter.onMessage(async (message) => {
      emitted.push(message);
    });

    await connection.handler?.({
      id: 'message-lid',
      from: '240539744137431@lid',
      senderPn: '255712345678:8@s.whatsapp.net',
      fromMe: false,
      pushName: 'Owner',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'show my tasks'
    });

    expect(emitted).toEqual([
      expect.objectContaining({
        conversationId: '255712345678@s.whatsapp.net',
        senderId: '255712345678',
        accessLevel: 'owner',
        text: 'show my tasks'
      })
    ]);
  });

  it('archives unauthorized messages without emitting them to the gateway by default', async () => {
    const connection = new FakeWhatsAppConnection();
    const archived: unknown[] = [];
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678']),
      archive: {
        recordMessage: async (input) => {
          archived.push(input);
        }
      }
    });
    const emitted: ChannelMessage[] = [];
    adapter.onMessage(async (message) => {
      emitted.push(message);
    });

    await connection.handler?.({
      id: 'message-2',
      from: '255700000000@s.whatsapp.net',
      fromMe: false,
      pushName: 'Client',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'deadline is Friday'
    });

    expect(emitted).toEqual([]);
    expect(archived).toHaveLength(1);
  });

  it('archives WhatsApp contact names from the connection', async () => {
    const connection = new FakeWhatsAppConnection();
    const archivedContacts: unknown[] = [];
    new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678']),
      archive: {
        recordMessage: async () => undefined,
        recordContact: async (input: unknown) => {
          archivedContacts.push(input);
        }
      } as any
    });

    await connection.contactHandler?.({
      remoteJid: '255700000000@s.whatsapp.net',
      displayName: 'Amina Home'
    });

    expect(archivedContacts).toEqual([
      {
        remoteJid: '255700000000@s.whatsapp.net',
        displayName: 'Amina Home'
      }
    ]);
  });

  it('emits public WhatsApp messages when reply-to-all mode is enabled', async () => {
    const connection = new FakeWhatsAppConnection();
    const archived: unknown[] = [];
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678']),
      archive: {
        recordMessage: async (input) => {
          archived.push(input);
        }
      },
      options: {
        replyToAll: true
      }
    });
    const emitted: ChannelMessage[] = [];
    adapter.onMessage(async (message) => {
      emitted.push(message);
    });

    await connection.handler?.({
      id: 'message-public',
      from: '255700000000@s.whatsapp.net',
      fromMe: false,
      pushName: 'Public User',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'Habari, unaweza kunisaidia?'
    });

    expect(emitted).toEqual([
      expect.objectContaining({
        conversationId: '255700000000@s.whatsapp.net',
        senderId: '255700000000',
        senderDisplayName: 'Public User',
        accessLevel: 'public',
        text: 'Habari, unaweza kunisaidia?'
      })
    ]);
    expect(archived).toHaveLength(1);
  });

  it('archives but does not emit public lid messages until phone metadata is available', async () => {
    const connection = new FakeWhatsAppConnection();
    const archived: unknown[] = [];
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678']),
      archive: {
        recordMessage: async (input) => {
          archived.push(input);
        }
      },
      options: {
        replyToAll: true
      }
    });
    const emitted: ChannelMessage[] = [];
    adapter.onMessage(async (message) => {
      emitted.push(message);
    });

    await connection.handler?.({
      id: 'message-lid-no-phone',
      from: '240539744137431@lid',
      fromMe: false,
      pushName: 'Public LID User',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'hello'
    });

    expect(emitted).toEqual([]);
    expect(archived).toHaveLength(1);
  });

  it('emits prefixed from-me commands to the owner self chat', async () => {
    const connection = new FakeWhatsAppConnection();
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678']),
      options: {
        processFromMeCommands: true,
        fromMeCommandPrefix: '/agent',
        ownerWhatsAppNumber: '255621214785'
      }
    });
    const emitted: ChannelMessage[] = [];
    adapter.onMessage(async (message) => {
      emitted.push(message);
    });

    await connection.handler?.({
      id: 'message-3',
      from: '123456789@lid',
      senderPn: '255712345678:8@s.whatsapp.net',
      fromMe: true,
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: '/agent summarize my chats'
    });

    expect(emitted).toEqual([
      expect.objectContaining({
        channel: 'whatsapp',
        conversationId: '255712345678@s.whatsapp.net',
        senderId: '255712345678',
        accessLevel: 'owner',
        fromSelf: true,
        text: 'summarize my chats'
      })
    ]);
  });
});
