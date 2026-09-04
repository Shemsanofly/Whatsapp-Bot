import { GatewayRuntime } from '../../../src/gateway/GatewayRuntime.js';
import type { ChannelAdapter, ChannelHealth, ChannelMessage, GatewayAgentPort } from '../../../src/gateway/types.js';

class FakeChannel implements ChannelAdapter {
  public handler?: (message: ChannelMessage) => Promise<void>;
  public starts = 0;
  public stops = 0;
  public sent: Array<{ target: string; text: string }> = [];

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly enabled = true
  ) {}

  onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.starts += 1;
  }

  async stop(): Promise<void> {
    this.stops += 1;
  }

  async sendText(target: string, text: string): Promise<void> {
    this.sent.push({ target, text });
  }

  getHealth(): ChannelHealth {
    return { connected: this.starts > 0, authenticated: this.starts > 0 };
  }
}

describe('GatewayRuntime', () => {
  it('routes inbound channel messages to the agent and replies through the same channel', async () => {
    const channel = new FakeChannel('whatsapp', 'WhatsApp');
    const agent: GatewayAgentPort = {
      handleMessage: async (message) => `processed ${message.text} on ${message.channel}`
    };
    const gateway = new GatewayRuntime({ channels: [channel], agent });

    await gateway.start();
    await channel.handler?.({
      channel: 'whatsapp',
      messageId: 'message-1',
      conversationId: '255712345678@s.whatsapp.net',
      senderId: '255712345678',
      text: 'show my tasks',
      fromSelf: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z')
    });

    expect(channel.sent).toEqual([
      { target: '255712345678@s.whatsapp.net', text: 'processed show my tasks on whatsapp' }
    ]);
  });

  it('preserves reply order for concurrent messages in the same conversation', async () => {
    const channel = new FakeChannel('whatsapp', 'WhatsApp');
    let releaseFirstMessage: (() => void) | undefined;
    const agent: GatewayAgentPort = {
      handleMessage: async (message) => {
        if (message.messageId === 'message-1') {
          await new Promise<void>((resolve) => {
            releaseFirstMessage = resolve;
          });
        }
        return `processed ${message.messageId}`;
      }
    };
    const gateway = new GatewayRuntime({ channels: [channel], agent });

    await gateway.start();
    const first = channel.handler?.({
      channel: 'whatsapp',
      messageId: 'message-1',
      conversationId: '255712345678@s.whatsapp.net',
      senderId: '255712345678',
      text: 'slow',
      fromSelf: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z')
    });
    const second = channel.handler?.({
      channel: 'whatsapp',
      messageId: 'message-2',
      conversationId: '255712345678@s.whatsapp.net',
      senderId: '255712345678',
      text: 'fast',
      fromSelf: false,
      timestamp: new Date('2026-08-29T12:00:01.000Z')
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirstMessage?.();

    await Promise.all([first, second]);

    expect(channel.sent).toEqual([
      { target: '255712345678@s.whatsapp.net', text: 'processed message-1' },
      { target: '255712345678@s.whatsapp.net', text: 'processed message-2' }
    ]);
  });

  it('ignores duplicate channel message ids after the first reply is queued', async () => {
    const channel = new FakeChannel('whatsapp', 'WhatsApp');
    const handled: string[] = [];
    const agent: GatewayAgentPort = {
      handleMessage: async (message) => {
        handled.push(message.messageId ?? '');
        return `processed ${message.text}`;
      }
    };
    const gateway = new GatewayRuntime({ channels: [channel], agent });

    await gateway.start();
    await channel.handler?.({
      channel: 'whatsapp',
      messageId: 'duplicate-message',
      conversationId: '255712345678@s.whatsapp.net',
      senderId: '255712345678',
      text: 'hello',
      fromSelf: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z')
    });
    await channel.handler?.({
      channel: 'whatsapp',
      messageId: 'duplicate-message',
      conversationId: '240539744137431@lid',
      senderId: '240539744137431',
      text: 'hello',
      fromSelf: false,
      timestamp: new Date('2026-08-29T12:00:01.000Z')
    });

    expect(handled).toEqual(['duplicate-message']);
    expect(channel.sent).toEqual([
      { target: '255712345678@s.whatsapp.net', text: 'processed hello' }
    ]);
  });

  it('does not start disabled channels', async () => {
    const channel = new FakeChannel('telegram', 'Telegram', false);
    const gateway = new GatewayRuntime({
      channels: [channel],
      agent: { handleMessage: async () => 'ok' }
    });

    await gateway.start();

    expect(channel.starts).toBe(0);
    expect(gateway.listChannels()).toEqual([
      { id: 'telegram', name: 'Telegram', enabled: false, health: { connected: false, authenticated: false } }
    ]);
  });
});
