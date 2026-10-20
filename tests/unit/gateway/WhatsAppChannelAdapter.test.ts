import { WhatsAppChannelAdapter } from '../../../src/gateway/WhatsAppChannelAdapter.js';
import { WhatsAppAuthorizer } from '../../../src/security/WhatsAppAuthorizer.js';
import type { ChannelMessage } from '../../../src/gateway/types.js';
import type { IncomingWhatsAppMessage, WhatsAppHealth } from '../../../src/whatsapp/types.js';

class FakeWhatsAppConnection {
  public handler?: (message: IncomingWhatsAppMessage) => Promise<void>;
  public contactHandler?: (contact: { remoteJid: string; displayName?: string }) => Promise<void>;
  public starts = 0;
  public stops = 0;
  public sent: Array<{ to: string; text: string; options?: unknown }> = [];
  public typing: Array<{ to: string; typing: boolean }> = [];
  public read: string[] = [];
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

  async sendText(to: string, text: string, options?: unknown): Promise<void> {
    this.sent.push(options ? { to, text, options } : { to, text });
  }

  getSelfIds(): string[] {
    return ['255799999999', '88888888888'];
  }

  async markRead(message: IncomingWhatsAppMessage): Promise<void> {
    this.read.push(message.id);
  }

  async sendTyping(to: string, typing: boolean): Promise<void> {
    this.typing.push({ to, typing });
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
        isGroup: false,
        text: 'show my tasks',
        timestamp: new Date('2026-08-29T12:00:00.000Z'),
        raw: expect.any(Object)
      }
    ]);
  });

  it('uses phone-number metadata for WhatsApp lid control message identity', async () => {
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
        conversationId: '240539744137431@lid',
        senderId: '255712345678',
        accessLevel: 'owner',
        text: 'show my tasks'
      })
    ]);
  });

  it('emits public WhatsApp lid messages back to the same chat when phone metadata is available', async () => {
    const connection = new FakeWhatsAppConnection();
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678']),
      options: {
        replyToAll: true
      }
    });
    const emitted: ChannelMessage[] = [];
    adapter.onMessage(async (message) => {
      emitted.push(message);
    });

    await connection.handler?.({
      id: 'message-public-lid',
      from: '240539744137431@lid',
      senderPn: '255700000000@s.whatsapp.net',
      fromMe: false,
      pushName: 'Public LID User',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'hello'
    });

    expect(emitted).toEqual([
      expect.objectContaining({
        conversationId: '240539744137431@lid',
        senderId: '255700000000',
        accessLevel: 'public',
        text: 'hello'
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

  it('emits public lid messages without phone metadata back to the same chat', async () => {
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

    expect(emitted).toEqual([
      expect.objectContaining({
        conversationId: '240539744137431@lid',
        senderId: '240539744137431',
        accessLevel: 'public',
        text: 'hello'
      })
    ]);
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

  describe('groups', () => {
    const groupMessage = (overrides: Partial<IncomingWhatsAppMessage>): IncomingWhatsAppMessage => ({
      id: 'group-message',
      from: '120363000000000000@g.us',
      participant: '16033834344469@lid',
      participantPn: '255700000000@s.whatsapp.net',
      pushName: 'Group Member',
      fromMe: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'hello everyone',
      ...overrides
    });

    function createGroupAdapter(groupReplyMode: 'off' | 'mention' | 'all') {
      const connection = new FakeWhatsAppConnection();
      const adapter = new WhatsAppChannelAdapter({
        connection,
        authorizer: new WhatsAppAuthorizer(['255712345678']),
        options: { replyToAll: true, groupReplyMode, groupCommandPrefix: '/hawa' }
      });
      const emitted: ChannelMessage[] = [];
      adapter.onMessage(async (message) => {
        emitted.push(message);
      });
      return { connection, adapter, emitted };
    }

    it('ignores group chatter that does not address the agent in mention mode', async () => {
      const { connection, emitted } = createGroupAdapter('mention');

      await connection.handler?.(groupMessage({}));

      expect(emitted).toEqual([]);
    });

    it('answers group members who @mention the agent and strips the mention', async () => {
      const { connection, emitted } = createGroupAdapter('mention');

      await connection.handler?.(groupMessage({
        text: '@255799999999 what time is it in Dodoma?',
        mentionedJids: ['255799999999@s.whatsapp.net']
      }));

      expect(emitted).toEqual([
        expect.objectContaining({
          conversationId: '120363000000000000@g.us',
          senderId: '255700000000',
          senderDisplayName: 'Group Member',
          accessLevel: 'public',
          isGroup: true,
          text: 'what time is it in Dodoma?'
        })
      ]);
    });

    it('recognizes lid mentions, replies to the agent, and the command prefix', async () => {
      const { connection, emitted } = createGroupAdapter('mention');

      await connection.handler?.(groupMessage({ id: 'a', text: '@88888888888 habari', mentionedJids: ['88888888888@lid'] }));
      await connection.handler?.(groupMessage({ id: 'b', text: 'and tomorrow?', quotedParticipant: '255799999999@s.whatsapp.net' }));
      await connection.handler?.(groupMessage({ id: 'c', text: '/HAWA tell us a joke' }));

      expect(emitted.map((message) => message.text)).toEqual(['habari', 'and tomorrow?', 'tell us a joke']);
    });

    it('answers every group message in all mode and none in off mode', async () => {
      const all = createGroupAdapter('all');
      const off = createGroupAdapter('off');

      await all.connection.handler?.(groupMessage({}));
      await off.connection.handler?.(groupMessage({ text: '/hawa hello' }));

      expect(all.emitted).toHaveLength(1);
      expect(off.emitted).toEqual([]);
    });

    it('never grants owner-only access inside a group', async () => {
      const { connection, emitted } = createGroupAdapter('mention');

      await connection.handler?.(groupMessage({
        participantPn: '255712345678@s.whatsapp.net',
        text: '/hawa summarize my chats'
      }));

      expect(emitted).toEqual([expect.objectContaining({ senderId: '255712345678', accessLevel: 'public' })]);
    });

    it('quotes the question when replying in a group but not in direct chats', async () => {
      const { connection, adapter } = createGroupAdapter('mention');
      const raw = groupMessage({ text: '/hawa hi' });

      await adapter.sendReply({
        channel: 'whatsapp', conversationId: raw.from, senderId: '255700000000', fromSelf: false,
        isGroup: true, text: 'hi', timestamp: raw.timestamp, raw
      }, 'Hello!');
      await adapter.sendReply({
        channel: 'whatsapp', conversationId: '255700000000@s.whatsapp.net', senderId: '255700000000', fromSelf: false,
        isGroup: false, text: 'hi', timestamp: raw.timestamp, raw
      }, 'Hello!');

      expect(connection.sent).toEqual([
        { to: raw.from, text: 'Hello!', options: { quoted: raw } },
        { to: '255700000000@s.whatsapp.net', text: 'Hello!' }
      ]);
    });
  });

  it('marks messages read and shows typing while the agent works', async () => {
    const connection = new FakeWhatsAppConnection();
    const adapter = new WhatsAppChannelAdapter({ connection, authorizer: new WhatsAppAuthorizer([]) });
    const raw: IncomingWhatsAppMessage = {
      id: 'typing-message', from: '255700000000@s.whatsapp.net', fromMe: false, timestamp: new Date(), text: 'hi'
    };
    const message: ChannelMessage = {
      channel: 'whatsapp', conversationId: raw.from, senderId: '255700000000', fromSelf: false, text: 'hi', timestamp: raw.timestamp, raw
    };

    await adapter.setTyping(message, true);
    await adapter.setTyping(message, false);

    expect(connection.read).toEqual(['typing-message']);
    expect(connection.typing).toEqual([
      { to: raw.from, typing: true },
      { to: raw.from, typing: false }
    ]);
  });

  it('archives backlog messages without replying to them', async () => {
    const connection = new FakeWhatsAppConnection();
    const archived: unknown[] = [];
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer([]),
      archive: { recordMessage: async (input) => { archived.push(input); } },
      options: { replyToAll: true }
    });
    const emitted: ChannelMessage[] = [];
    adapter.onMessage(async (message) => { emitted.push(message); });

    await connection.handler?.({
      id: 'old', from: '255700000000@s.whatsapp.net', fromMe: false, timestamp: new Date(), text: 'old question', isBacklog: true
    });

    expect(archived).toHaveLength(1);
    expect(emitted).toEqual([]);
  });

  it('rate limits public senders and warns them once', async () => {
    const connection = new FakeWhatsAppConnection();
    const adapter = new WhatsAppChannelAdapter({
      connection,
      authorizer: new WhatsAppAuthorizer(['255712345678']),
      options: { replyToAll: true, publicRateLimitPerMinute: 2 }
    });
    const emitted: ChannelMessage[] = [];
    adapter.onMessage(async (message) => { emitted.push(message); });
    const send = (id: string, from: string) => connection.handler?.({
      id, from, fromMe: false, timestamp: new Date(), text: 'question'
    });

    for (const id of ['1', '2', '3', '4']) {
      await send(id, '255700000000@s.whatsapp.net');
    }
    for (const id of ['5', '6', '7']) {
      await send(id, '255712345678@s.whatsapp.net');
    }

    expect(emitted.filter((message) => message.senderId === '255700000000')).toHaveLength(2);
    expect(emitted.filter((message) => message.senderId === '255712345678')).toHaveLength(3);
    expect(connection.sent).toEqual([
      { to: '255700000000@s.whatsapp.net', text: expect.stringContaining('faster than I can answer') }
    ]);
  });
});
